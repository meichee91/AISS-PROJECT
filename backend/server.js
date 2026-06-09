require("dotenv").config();

const express = require("express");
const path = require("path");
const {
  CATALOG_SOURCES,
  slugify,
  syncCatalogProducts,
  fetchCatalogProductsForCase,
  catalogPrompt
} = require("./catalog-sync");
const { sendSyncEmail } = require("./email-notifier");

const app = express();
const port = Number(process.env.PORT || 3000);
const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "");
const catalogSyncIntervalMinutes = Math.max(5, Number(process.env.CATALOG_SYNC_INTERVAL_MINUTES || 4320));
const catalogSyncEnabled = String(process.env.CATALOG_SYNC_ENABLED || "true").toLowerCase() !== "false";
const catalogSyncMaxPages = Math.max(0, Number(process.env.CATALOG_SYNC_MAX_PAGES_PER_CATEGORY || 0));
const catalogSyncOnStartup = String(process.env.CATALOG_SYNC_ON_STARTUP || "false").toLowerCase() === "true";

app.use(express.json({ limit: "10mb" }));

function chooseModel(payload) {
  const textSize = JSON.stringify(payload || {}).length;
  const followCount = Object.keys(payload?.followUpAnswers || {}).length;
  const chatCount = (payload?.chatUpdates || []).length;
  const fileCount = (payload?.chatUpdates || []).reduce((sum, item) => sum + (item.files?.length || 0), 0);
  const photoCount = (payload?.formPhotos || []).length;

  let score = 0;
  score += Math.min(6, Math.floor(textSize / 450));
  score += Math.min(4, followCount);
  score += Math.min(5, chatCount);
  score += Math.min(5, fileCount);
  score += Math.min(3, photoCount);

  return score >= 10 ? "gpt-5.4" : "gpt-5.4-mini";
}

function hasSupabase() {
  return !!supabaseUrl && !!supabaseKey;
}

function formatCaseNumber(category, sequence) {
  const slug = slugify(category);
  return `${slug}_${String(sequence).padStart(5, "0")}`;
}

async function supabaseRequest(resource, options = {}) {
  const { method = "GET", body, upsert = false, onConflict } = options;
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (upsert) {
    headers.Prefer = "resolution=merge-duplicates,return=representation";
  }

  const url = new URL(`${supabaseUrl}/rest/v1/${resource}`);
  if (onConflict) {
    url.searchParams.set("on_conflict", onConflict);
  }

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
  } catch (err) {
    const code = err?.cause?.code || err?.code || "";
    const message = err?.cause?.message || err?.message || "Unknown fetch error.";
    if (code === "ENOTFOUND") {
      throw new Error(`Supabase connection failed: hostname not found for ${supabaseUrl}. Check SUPABASE_URL in backend/.env.`);
    }
    throw new Error(`Supabase connection failed: ${message}`);
  }

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase request failed (${response.status}).`);
  }
  return data;
}

let localCaseSequence = 0;
const localCategorySequences = new Map();

async function reserveNextCaseNumber(category) {
  const categorySlug = slugify(category);
  const sequenceKey = `case_number_${categorySlug}`;
  if (!hasSupabase()) {
    const nextValue = Number(localCategorySequences.get(sequenceKey) || 0) + 1;
    localCategorySequences.set(sequenceKey, nextValue);
    localCaseSequence = Math.max(localCaseSequence, nextValue);
    return {
      caseNumber: formatCaseNumber(categorySlug, nextValue),
      source: "local"
    };
  }

  const rows = await supabaseRequest(`case_sequences?name=eq.${encodeURIComponent(sequenceKey)}&select=name,last_value`);
  const nextValue = Number(rows?.[0]?.last_value || 0) + 1;

  await supabaseRequest("case_sequences", {
    method: "POST",
    upsert: true,
    body: {
      name: sequenceKey,
      last_value: nextValue,
      updated_at: new Date().toISOString()
    }
  });

  return {
    caseNumber: formatCaseNumber(categorySlug, nextValue),
    source: "supabase"
  };
}

function buildCaseSearchText(caseContext) {
  const payload = caseContext?.formData || {};
  const core = [
    caseContext?.category,
    payload.application,
    payload.problem,
    payload.additionalInfo,
    payload.existing,
    payload.type,
    payload.load,
    payload.environment,
    payload.priority,
    payload.industry,
    ...(caseContext?.chatUpdates || []).map((item) => `${item.text || ""} ${(item.insights || []).join(" ")}`)
  ];
  return core.join(" ").toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function similarityScore(targetText, candidateText) {
  const targetTokens = new Set(targetText.split(" ").filter((token) => token.length > 2));
  const candidateTokens = new Set(String(candidateText || "").split(" ").filter((token) => token.length > 2));
  let overlap = 0;
  targetTokens.forEach((token) => {
    if (candidateTokens.has(token)) overlap += 1;
  });
  return overlap;
}

async function fetchSimilarHistoricalCases(caseContext) {
  return [];
}

function historicalReferencePrompt(caseContext, similarCases) {
  return "";
}

function formatCatalogProductsForResponse(products) {
  return (products || []).map((item) => ({
    productName: item.product_name,
    sku: item.sku,
    brand: item.brand,
    productUrl: item.product_url,
    priceText: item.price_text,
    availability: item.availability,
    shortDescription: item.short_description,
    sourceLabel: item.source_label,
    lastSyncedAt: item.last_synced_at
  }));
}

let catalogSyncState = {
  status: "idle",
  lastStartedAt: "",
  lastFinishedAt: "",
  lastError: "",
  lastSummary: null
};

async function runCatalogSync(trigger = "manual", categoriesFilter) {
  if (!hasSupabase()) {
    throw new Error("Supabase must be configured before catalog sync can run.");
  }
  if (catalogSyncState.status === "running") {
    return {
      skipped: true,
      reason: "Catalog sync is already running.",
      state: catalogSyncState
    };
  }

  catalogSyncState = {
    ...catalogSyncState,
    status: "running",
    lastStartedAt: new Date().toISOString(),
    lastError: ""
  };

  try {
    const summary = await syncCatalogProducts({
      supabaseRequest,
      categoriesFilter,
      maxPagesPerCategory: catalogSyncMaxPages,
      logger: console
    });
    catalogSyncState = {
      status: "idle",
      lastStartedAt: catalogSyncState.lastStartedAt,
      lastFinishedAt: new Date().toISOString(),
      lastError: "",
      lastSummary: {
        trigger,
        ...summary
      }
    };
    await sendSyncEmail("success", catalogSyncState.lastSummary).catch((err) => {
      console.warn(`[catalog-sync] success email failed: ${err.message}`);
    });
    return {
      skipped: false,
      summary: catalogSyncState.lastSummary
    };
  } catch (err) {
    catalogSyncState = {
      ...catalogSyncState,
      status: "idle",
      lastFinishedAt: new Date().toISOString(),
      lastError: err.message || "Catalog sync failed."
    };
    await sendSyncEmail("failure", {
      trigger,
      error: catalogSyncState.lastError
    }).catch((emailErr) => {
      console.warn(`[catalog-sync] failure email failed: ${emailErr.message}`);
    });
    throw err;
  }
}

async function saveHistoricalCase(payload) {
  if (!hasSupabase()) {
    return {
      saved: false,
      message: "Supabase is not configured yet, so the historical case was not stored."
    };
  }

  const rating = payload.rating === "bad" ? "bad" : "good";
  const category = payload.category || "Other";
  const categorySlug = slugify(category);
  const table = rating === "good" ? "historical_case_good" : "historical_case_bad";
  const folderRoot = rating === "good" ? "historical-case-good" : "historical-case-bad";

  await supabaseRequest(table, {
    method: "POST",
    body: {
      case_number: payload.casePayload?.caseNumber,
      pdf_name: payload.pdfName,
      category,
      category_slug: categorySlug,
      folder_path: `${folderRoot}/${categorySlug}/${payload.pdfName}`,
      rating,
      feedback_text: payload.feedbackText || "",
      refer_historical_cases: !!payload.referHistoricalCases,
      referenced_case_numbers: payload.referencedCaseNumbers || [],
      case_payload: payload.casePayload,
      ai_response: payload.aiResponse,
      created_at: new Date().toISOString()
    }
  });

  return {
    saved: true,
    message: `Saved into ${table}/${categorySlug} as ${payload.pdfName}.`
  };
}

app.get("/api/case-number/next", async (req, res) => {
  try {
    const category = String(req.query.category || "").trim();
    if (!category) {
      return res.status(400).json({ error: "category is required." });
    }
    return res.json(await reserveNextCaseNumber(category));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to assign case number." });
  }
});

app.post("/api/historical-case", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body?.casePayload?.caseNumber) {
      return res.status(400).json({ error: "casePayload.caseNumber is required." });
    }
    if (!body?.pdfName) {
      return res.status(400).json({ error: "pdfName is required." });
    }
    return res.json(await saveHistoricalCase(body));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to save historical case." });
  }
});

app.get("/api/catalog/status", async (req, res) => {
  return res.json({
    enabled: catalogSyncEnabled,
    intervalMinutes: catalogSyncIntervalMinutes,
    maxPagesPerCategory: catalogSyncMaxPages,
    categories: CATALOG_SOURCES.map((item) => ({
      appCategory: item.appCategory,
      sourceType: item.sourceType,
      label: item.label
    })),
    state: catalogSyncState
  });
});

app.post("/api/catalog/sync", async (req, res) => {
  try {
    const categories = Array.isArray(req.body?.categories)
      ? req.body.categories.map((item) => String(item || "").trim()).filter(Boolean)
      : undefined;
    return res.json(await runCatalogSync("manual", categories));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to run catalog sync." });
  }
});

app.post("/api/analyze", async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: "OPENAI_API_KEY is missing on backend." });
    }

    const body = req.body || {};
    const caseContext = body.caseContext || {};
    const similarCases = await fetchSimilarHistoricalCases(caseContext);
    const model = body.model || chooseModel(body);
    const requestBody = {
      ...body,
      model
    };

    delete requestBody.caseContext;

    if (Array.isArray(requestBody.input)) {
      const referenceText = historicalReferencePrompt(caseContext, similarCases);
      if (referenceText) {
        requestBody.input = [
          ...requestBody.input,
          {
            role: "user",
            content: [{ type: "input_text", text: referenceText }]
          }
        ];
      }
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.json({
      ...data,
      retrieved_case_numbers: similarCases.map((item) => item.case_number)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error." });
  }
});

const frontendPath = path.resolve(__dirname, "..", "frontend");
app.use(express.static(frontendPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendPath, "index.html"));
});

app.listen(port, () => {
  console.log(`AISS PROJECT backend running on http://localhost:${port}`);
  if (catalogSyncEnabled && hasSupabase()) {
    if (catalogSyncOnStartup) {
      runCatalogSync("startup").catch((err) => {
        console.warn(`[catalog-sync] startup failed: ${err.message}`);
      });
    }
    setInterval(() => {
      runCatalogSync("scheduled").catch((err) => {
        console.warn(`[catalog-sync] scheduled run failed: ${err.message}`);
      });
    }, catalogSyncIntervalMinutes * 60 * 1000);
  }
});

require("dotenv").config();

const express = require("express");
const path = require("path");
const { randomUUID } = require("crypto");
const sql = require("mssql");
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
const azureOpenAiEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "").replace(/\/+$/, "");
const azureOpenAiApiKey = String(process.env.AZURE_OPENAI_API_KEY || "").trim();
const azureOpenAiApiVersion = String(process.env.AZURE_OPENAI_API_VERSION || "").trim();
const azureOpenAiDeploymentDefault = String(process.env.AZURE_OPENAI_DEPLOYMENT || "").trim();
const azureOpenAiDeployment54 = String(process.env.AZURE_OPENAI_DEPLOYMENT_GPT_5_4 || "").trim();
const azureOpenAiDeployment54Mini = String(process.env.AZURE_OPENAI_DEPLOYMENT_GPT_5_4_MINI || "").trim();
const azureSqlServer = String(process.env.AZURE_SQL_SERVER || "").trim();
const azureSqlDatabase = String(process.env.AZURE_SQL_DATABASE || "").trim();
const azureSqlUser = String(process.env.AZURE_SQL_USER || "").trim();
const azureSqlPassword = String(process.env.AZURE_SQL_PASSWORD || "");
const azureSqlEncrypt = String(process.env.AZURE_SQL_ENCRYPT || "true").toLowerCase() !== "false";
const azureSqlTrustServerCertificate = String(process.env.AZURE_SQL_TRUST_SERVER_CERTIFICATE || "false").toLowerCase() === "true";
const catalogSyncIntervalMinutes = Math.max(5, Number(process.env.CATALOG_SYNC_INTERVAL_MINUTES || 4320));
const catalogSyncEnabled = String(process.env.CATALOG_SYNC_ENABLED || "true").toLowerCase() !== "false";
const catalogSyncMaxPages = Math.max(0, Number(process.env.CATALOG_SYNC_MAX_PAGES_PER_CATEGORY || 0));
const catalogSyncOnStartup = String(process.env.CATALOG_SYNC_ON_STARTUP || "false").toLowerCase() === "true";
const promptVersion = String(process.env.AISS_PROMPT_VERSION || "phase2-v1");
const localAiRunLogs = [];
const localAppEventLogs = [];
const localEvalCases = [];
const MAX_LOCAL_LOGS = 150;
let azureSqlPoolPromise = null;
const CASE_STATUS = {
  DRAFT: "Draft",
  AI_GENERATED: "AI Generated",
  PENDING_EXPERT_REVIEW: "Pending Expert Review",
  VERIFIED_GOOD: "Verified - Good",
  VERIFIED_CORRECTED: "Verified - Corrected",
  VERIFIED_REJECTED: "Verified - Rejected",
  ARCHIVED: "Archived"
};

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

function hasAzureOpenAi() {
  return !!azureOpenAiEndpoint && !!azureOpenAiApiKey;
}

function resolveAzureDeployment(modelName) {
  if (modelName === "gpt-5.4" && azureOpenAiDeployment54) return azureOpenAiDeployment54;
  if (modelName === "gpt-5.4-mini" && azureOpenAiDeployment54Mini) return azureOpenAiDeployment54Mini;
  return azureOpenAiDeploymentDefault || modelName;
}

function buildAzureOpenAiUrl() {
  const baseUrl = `${azureOpenAiEndpoint}/openai/v1/responses`;
  if (!azureOpenAiApiVersion) return baseUrl;
  const url = new URL(baseUrl);
  url.searchParams.set("api-version", azureOpenAiApiVersion);
  return url.toString();
}

function hasAzureSql() {
  return !!azureSqlServer && !!azureSqlDatabase && !!azureSqlUser && !!azureSqlPassword;
}

function getStorageMode() {
  if (hasAzureSql()) return "azure-sql";
  return "local";
}

function formatCaseNumber(category, sequence) {
  const slug = slugify(category);
  return `${slug}_${String(sequence).padStart(5, "0")}`;
}

function cappedPush(list, entry) {
  list.unshift(entry);
  if (list.length > MAX_LOCAL_LOGS) {
    list.length = MAX_LOCAL_LOGS;
  }
}

function summarizeUsage(usage) {
  const inputTokens = Number(usage?.input_tokens || usage?.inputTokens || 0);
  const outputTokens = Number(usage?.output_tokens || usage?.outputTokens || 0);
  const totalTokens = Number(usage?.total_tokens || usage?.totalTokens || inputTokens + outputTokens || 0);
  const reasoningTokens = Number(usage?.output_tokens_details?.reasoning_tokens || 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens
  };
}

function cleanText(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanLargeText(value, max = 6000) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function caseRecordColumns() {
  return `
    case_number, pdf_name, category, category_slug, folder_path, rating, feedback_text,
    user_comment, case_status, expert_decision, expert_rating, expert_comment,
    corrected_recommendation, knowledge_value, reviewer_name, learning_eligible,
    reference_type, refer_historical_cases, referenced_case_numbers, case_payload,
    ai_response, reviewed_at, created_at, updated_at
  `;
}

function mapHistoricalCaseRow(item, sourceTable = "") {
  const casePayload = parseJsonText(item.case_payload, {});
  const aiResponse = parseJsonText(item.ai_response, {});
  const referencedCaseNumbers = parseJsonText(item.referenced_case_numbers, []);
  return {
    caseNumber: item.case_number,
    pdfName: item.pdf_name,
    category: item.category,
    categorySlug: item.category_slug,
    folderPath: item.folder_path,
    rating: item.rating,
    feedbackText: item.feedback_text,
    userComment: item.user_comment || "",
    caseStatus: item.case_status || CASE_STATUS.AI_GENERATED,
    expertDecision: item.expert_decision || "",
    expertRating: item.expert_rating || "",
    expertComment: item.expert_comment || "",
    correctedRecommendation: item.corrected_recommendation || "",
    knowledgeValue: item.knowledge_value || "",
    reviewerName: item.reviewer_name || "",
    learningEligible: !!item.learning_eligible,
    referenceType: item.reference_type || "",
    referHistoricalCases: !!item.refer_historical_cases,
    referencedCaseNumbers,
    casePayload,
    aiResponse,
    reviewedAt: item.reviewed_at || "",
    createdAt: item.created_at || "",
    updatedAt: item.updated_at || item.created_at || "",
    sourceTable
  };
}

function deriveReferenceMeta(expertDecision) {
  const decision = String(expertDecision || "").trim();
  if (decision === CASE_STATUS.VERIFIED_GOOD) {
    return { learningEligible: true, referenceType: "positive" };
  }
  if (decision === CASE_STATUS.VERIFIED_CORRECTED) {
    return { learningEligible: true, referenceType: "corrective" };
  }
  return { learningEligible: false, referenceType: "" };
}

async function getAzureSqlPool() {
  if (!hasAzureSql()) {
    throw new Error("Azure SQL is not configured.");
  }
  if (!azureSqlPoolPromise) {
    azureSqlPoolPromise = sql.connect({
      server: azureSqlServer,
      database: azureSqlDatabase,
      user: azureSqlUser,
      password: azureSqlPassword,
      options: {
        encrypt: azureSqlEncrypt,
        trustServerCertificate: azureSqlTrustServerCertificate
      },
      pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
      }
    });
  }
  return azureSqlPoolPromise;
}

function jsonText(value, fallback = "{}") {
  try {
    return JSON.stringify(value ?? JSON.parse(fallback));
  } catch (err) {
    return fallback;
  }
}

function parseJsonText(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

async function azureQuery(queryText, binder) {
  try {
    const pool = await getAzureSqlPool();
    const request = pool.request();
    if (typeof binder === "function") binder(request);
    const result = await request.query(queryText);
    return result.recordset || [];
  } catch (err) {
    throw new Error(`Azure SQL request failed: ${err.message}`);
  }
}

async function azureReserveNextCaseNumber(category) {
  const categorySlug = slugify(category);
  const sequenceKey = `case_number_${categorySlug}`;
  const pool = await getAzureSqlPool();
  const transaction = new sql.Transaction(pool);
  try {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = new sql.Request(transaction);
    request.input("name", sql.NVarChar(120), sequenceKey);
    const existing = await request.query("SELECT last_value FROM dbo.case_sequences WITH (UPDLOCK, HOLDLOCK) WHERE name = @name");
    const nextValue = Number(existing.recordset?.[0]?.last_value || 0) + 1;
    const write = new sql.Request(transaction);
    write.input("name", sql.NVarChar(120), sequenceKey);
    write.input("lastValue", sql.BigInt, nextValue);
    await write.query(`
      MERGE dbo.case_sequences AS target
      USING (SELECT @name AS name, @lastValue AS last_value) AS source
      ON target.name = source.name
      WHEN MATCHED THEN
        UPDATE SET last_value = source.last_value, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (name, last_value, updated_at) VALUES (source.name, source.last_value, SYSUTCDATETIME());
    `);
    await transaction.commit();
    return {
      caseNumber: formatCaseNumber(categorySlug, nextValue),
      source: "azure-sql"
    };
  } catch (err) {
    try { await transaction.rollback(); } catch (_) { void _; }
    throw new Error(`Azure SQL case number failed: ${err.message}`);
  }
}

async function azureInsertHistoricalCase(payload) {
  const rating = payload.rating === "bad" ? "bad" : "good";
  const category = payload.category || "Other";
  const categorySlug = slugify(category);
  const table = rating === "good" ? "dbo.historical_case_good" : "dbo.historical_case_bad";
  const otherTable = rating === "good" ? "dbo.historical_case_bad" : "dbo.historical_case_good";
  const folderRoot = rating === "good" ? "historical-case-good" : "historical-case-bad";
  await azureQuery(`DELETE FROM ${otherTable} WHERE case_number = @caseNumber;`, (request) => {
    request.input("caseNumber", sql.NVarChar(120), payload.casePayload?.caseNumber || "");
  });
  await azureQuery(`
    MERGE ${table} AS target
    USING (SELECT @caseNumber AS case_number) AS source
    ON target.case_number = source.case_number
    WHEN MATCHED THEN UPDATE SET
      pdf_name = @pdfName,
      category = @category,
      category_slug = @categorySlug,
      folder_path = @folderPath,
      rating = @rating,
      feedback_text = @feedbackText,
      user_comment = @userComment,
      case_status = @caseStatus,
      refer_historical_cases = @referHistoricalCases,
      referenced_case_numbers = @referencedCaseNumbers,
      case_payload = @casePayload,
      ai_response = @aiResponse,
      updated_at = SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT
      (case_number, pdf_name, category, category_slug, folder_path, rating, feedback_text, user_comment, case_status, expert_decision, expert_rating, expert_comment, corrected_recommendation, knowledge_value, reviewer_name, learning_eligible, reference_type, refer_historical_cases, referenced_case_numbers, case_payload, ai_response, reviewed_at, created_at, updated_at)
      VALUES
      (@caseNumber, @pdfName, @category, @categorySlug, @folderPath, @rating, @feedbackText, @userComment, @caseStatus, '', '', '', '', '', '', 0, '', @referHistoricalCases, @referencedCaseNumbers, @casePayload, @aiResponse, NULL, SYSUTCDATETIME(), SYSUTCDATETIME());
  `, (request) => {
    request.input("caseNumber", sql.NVarChar(120), payload.casePayload?.caseNumber || "");
    request.input("pdfName", sql.NVarChar(255), payload.pdfName || "");
    request.input("category", sql.NVarChar(120), category);
    request.input("categorySlug", sql.NVarChar(120), categorySlug);
    request.input("folderPath", sql.NVarChar(400), `${folderRoot}/${categorySlug}/${payload.pdfName}`);
    request.input("rating", sql.NVarChar(20), rating);
    request.input("feedbackText", sql.NVarChar(sql.MAX), payload.feedbackText || "");
    request.input("userComment", sql.NVarChar(sql.MAX), payload.userComment || "");
    request.input("caseStatus", sql.NVarChar(60), payload.caseStatus || CASE_STATUS.PENDING_EXPERT_REVIEW);
    request.input("referHistoricalCases", sql.Bit, payload.referHistoricalCases ? 1 : 0);
    request.input("referencedCaseNumbers", sql.NVarChar(sql.MAX), jsonText(payload.referencedCaseNumbers || [], "[]"));
    request.input("casePayload", sql.NVarChar(sql.MAX), jsonText(payload.casePayload || {}, "{}"));
    request.input("aiResponse", sql.NVarChar(sql.MAX), jsonText(payload.aiResponse || {}, "{}"));
  });
  return {
    saved: true,
    message: `Saved into ${table.split(".")[1]}/${categorySlug} as ${payload.pdfName}.`
  };
}

async function azureInsertAiRun(record) {
  await azureQuery(`
    MERGE dbo.ai_run_logs AS target
    USING (SELECT @requestId AS request_id) AS source
    ON target.request_id = source.request_id
    WHEN MATCHED THEN UPDATE SET
      case_number = @caseNumber,
      category = @category,
      category_slug = @categorySlug,
      user_name = @userName,
      model = @model,
      prompt_version = @promptVersion,
      status = @status,
      latency_ms = @latencyMs,
      input_chars = @inputChars,
      usage_json = @usageJson,
      error_message = @errorMessage,
      source = @source,
      recommendation_json = @recommendationJson,
      created_at = @createdAt
    WHEN NOT MATCHED THEN
      INSERT (request_id, case_number, category, category_slug, user_name, model, prompt_version, status, latency_ms, input_chars, usage_json, error_message, source, recommendation_json, created_at)
      VALUES (@requestId, @caseNumber, @category, @categorySlug, @userName, @model, @promptVersion, @status, @latencyMs, @inputChars, @usageJson, @errorMessage, @source, @recommendationJson, @createdAt);
  `, (request) => {
    request.input("requestId", sql.NVarChar(120), record.request_id);
    request.input("caseNumber", sql.NVarChar(120), record.case_number);
    request.input("category", sql.NVarChar(120), record.category);
    request.input("categorySlug", sql.NVarChar(120), record.category_slug);
    request.input("userName", sql.NVarChar(255), record.user_name);
    request.input("model", sql.NVarChar(120), record.model);
    request.input("promptVersion", sql.NVarChar(120), record.prompt_version);
    request.input("status", sql.NVarChar(40), record.status);
    request.input("latencyMs", sql.Int, Number(record.latency_ms || 0));
    request.input("inputChars", sql.Int, Number(record.input_chars || 0));
    request.input("usageJson", sql.NVarChar(sql.MAX), jsonText(record.usage_json || {}, "{}"));
    request.input("errorMessage", sql.NVarChar(sql.MAX), record.error_message || "");
    request.input("source", sql.NVarChar(60), record.source || "web");
    request.input("recommendationJson", sql.NVarChar(sql.MAX), record.recommendation_json ? jsonText(record.recommendation_json, "{}") : null);
    request.input("createdAt", sql.DateTime2, new Date(record.created_at));
  });
}

async function azureInsertAppEvent(record) {
  await azureQuery(`
    INSERT INTO dbo.app_event_logs
      (event_name, event_detail, level, case_number, category, category_slug, request_id, created_at)
    VALUES
      (@eventName, @eventDetail, @level, @caseNumber, @category, @categorySlug, @requestId, @createdAt);
  `, (request) => {
    request.input("eventName", sql.NVarChar(120), record.event_name);
    request.input("eventDetail", sql.NVarChar(sql.MAX), record.event_detail);
    request.input("level", sql.NVarChar(20), record.level);
    request.input("caseNumber", sql.NVarChar(120), record.case_number);
    request.input("category", sql.NVarChar(120), record.category);
    request.input("categorySlug", sql.NVarChar(120), record.category_slug);
    request.input("requestId", sql.NVarChar(120), record.request_id);
    request.input("createdAt", sql.DateTime2, new Date(record.created_at));
  });
}

async function azureInsertEvalCase(record) {
  await azureQuery(`
    INSERT INTO dbo.eval_cases
      (case_number, category, category_slug, user_name, rating, evaluation_note, source_run_request_id, case_payload, ai_response, created_at)
    VALUES
      (@caseNumber, @category, @categorySlug, @userName, @rating, @evaluationNote, @sourceRunRequestId, @casePayload, @aiResponse, @createdAt);
  `, (request) => {
    request.input("caseNumber", sql.NVarChar(120), record.case_number);
    request.input("category", sql.NVarChar(120), record.category);
    request.input("categorySlug", sql.NVarChar(120), record.category_slug);
    request.input("userName", sql.NVarChar(255), record.user_name);
    request.input("rating", sql.NVarChar(40), record.rating);
    request.input("evaluationNote", sql.NVarChar(sql.MAX), record.evaluation_note);
    request.input("sourceRunRequestId", sql.NVarChar(120), record.source_run_request_id);
    request.input("casePayload", sql.NVarChar(sql.MAX), jsonText(record.case_payload || {}, "{}"));
    request.input("aiResponse", sql.NVarChar(sql.MAX), jsonText(record.ai_response || {}, "{}"));
    request.input("createdAt", sql.DateTime2, new Date(record.created_at));
  });
}

async function azureUpsertProductCatalog(products) {
  for (const item of products) {
    await azureQuery(`
      MERGE dbo.product_catalog AS target
      USING (SELECT @productUrl AS product_url) AS source
      ON target.product_url = source.product_url
      WHEN MATCHED THEN UPDATE SET
        app_category = @appCategory,
        app_category_slug = @appCategorySlug,
        source_type = @sourceType,
        source_label = @sourceLabel,
        source_url = @sourceUrl,
        product_name = @productName,
        product_slug = @productSlug,
        sku = @sku,
        brand = @brand,
        price_text = @priceText,
        currency = @currency,
        availability = @availability,
        short_description = @shortDescription,
        specs_json = @specsJson,
        category_trail = @categoryTrail,
        searchable_text = @searchableText,
        is_active = @isActive,
        source_updated_at = @sourceUpdatedAt,
        last_synced_at = @lastSyncedAt
      WHEN NOT MATCHED THEN INSERT
        (app_category, app_category_slug, source_type, source_label, source_url, product_name, product_slug, sku, brand, product_url, price_text, currency, availability, short_description, specs_json, category_trail, searchable_text, is_active, source_updated_at, last_synced_at)
      VALUES
        (@appCategory, @appCategorySlug, @sourceType, @sourceLabel, @sourceUrl, @productName, @productSlug, @sku, @brand, @productUrl, @priceText, @currency, @availability, @shortDescription, @specsJson, @categoryTrail, @searchableText, @isActive, @sourceUpdatedAt, @lastSyncedAt);
    `, (request) => {
      request.input("appCategory", sql.NVarChar(120), item.app_category);
      request.input("appCategorySlug", sql.NVarChar(120), item.app_category_slug);
      request.input("sourceType", sql.NVarChar(40), item.source_type);
      request.input("sourceLabel", sql.NVarChar(255), item.source_label);
      request.input("sourceUrl", sql.NVarChar(500), item.source_url);
      request.input("productName", sql.NVarChar(255), item.product_name);
      request.input("productSlug", sql.NVarChar(255), item.product_slug);
      request.input("sku", sql.NVarChar(120), item.sku || "");
      request.input("brand", sql.NVarChar(120), item.brand || "");
      request.input("productUrl", sql.NVarChar(500), item.product_url);
      request.input("priceText", sql.NVarChar(120), item.price_text || "");
      request.input("currency", sql.NVarChar(20), item.currency || "MYR");
      request.input("availability", sql.NVarChar(60), item.availability || "unknown");
      request.input("shortDescription", sql.NVarChar(sql.MAX), item.short_description || "");
      request.input("specsJson", sql.NVarChar(sql.MAX), jsonText(item.specs_json || {}, "{}"));
      request.input("categoryTrail", sql.NVarChar(sql.MAX), jsonText(item.category_trail || [], "[]"));
      request.input("searchableText", sql.NVarChar(sql.MAX), item.searchable_text || "");
      request.input("isActive", sql.Bit, item.is_active ? 1 : 0);
      request.input("sourceUpdatedAt", sql.DateTime2, new Date(item.source_updated_at));
      request.input("lastSyncedAt", sql.DateTime2, new Date(item.last_synced_at));
    });
  }
}

async function azureDeactivateMissingProducts(categorySlug, seenUrls) {
  let queryText = `
    UPDATE dbo.product_catalog
    SET is_active = 0, last_synced_at = SYSUTCDATETIME()
    WHERE app_category_slug = @categorySlug
  `;
  await azureQuery(`${queryText}${seenUrls.length ? ` AND product_url NOT IN (${seenUrls.map((_, i) => `@url${i}`).join(", ")})` : ""};`, (request) => {
    request.input("categorySlug", sql.NVarChar(120), categorySlug);
    seenUrls.forEach((url, index) => {
      request.input(`url${index}`, sql.NVarChar(500), url);
    });
  });
}

async function azureSaveProductSyncRun(entry) {
  await azureQuery(`
    MERGE dbo.product_sync_runs AS target
    USING (SELECT @runId AS run_id) AS source
    ON target.run_id = source.run_id
    WHEN MATCHED THEN UPDATE SET
      sync_scope = @syncScope,
      status = @status,
      details_json = @detailsJson,
      started_at = @startedAt,
      finished_at = @finishedAt
    WHEN NOT MATCHED THEN INSERT
      (run_id, sync_scope, status, details_json, started_at, finished_at)
      VALUES (@runId, @syncScope, @status, @detailsJson, @startedAt, @finishedAt);
  `, (request) => {
    request.input("runId", sql.NVarChar(120), entry.runId);
    request.input("syncScope", sql.NVarChar(120), entry.syncScope);
    request.input("status", sql.NVarChar(40), entry.status);
    request.input("detailsJson", sql.NVarChar(sql.MAX), jsonText(entry.details || {}, "{}"));
    request.input("startedAt", sql.DateTime2, new Date(entry.startedAt));
    request.input("finishedAt", sql.DateTime2, new Date(entry.finishedAt));
  });
}

async function azureFetchCatalogProductsByCategory(categorySlug, limit = 250) {
  const rows = await azureQuery(`
    SELECT TOP (${Math.max(1, Math.min(limit, 250))})
      product_name, sku, brand, product_url, price_text, currency, availability, short_description, specs_json, searchable_text, source_label, last_synced_at
    FROM dbo.product_catalog
    WHERE app_category_slug = @categorySlug AND is_active = 1
    ORDER BY last_synced_at DESC;
  `, (request) => {
    request.input("categorySlug", sql.NVarChar(120), categorySlug);
  });
  return rows.map((item) => ({
    ...item,
    specs_json: parseJsonText(item.specs_json, {})
  }));
}

async function azureCount(tableName) {
  const rows = await azureQuery(`SELECT COUNT(1) AS count_value FROM ${tableName};`);
  return Number(rows?.[0]?.count_value || 0);
}

async function azureTopRows(tableName, columns, limit = 20, orderBy = "created_at DESC") {
  return azureQuery(`SELECT TOP (${Math.max(1, limit)}) ${columns} FROM ${tableName} ORDER BY ${orderBy};`);
}

async function azureFindHistoricalCase(caseNumber) {
  const lookup = async (tableName) => {
    const rows = await azureQuery(`
      SELECT TOP (1) ${caseRecordColumns()}
      FROM ${tableName}
      WHERE case_number = @caseNumber;
    `, (request) => {
      request.input("caseNumber", sql.NVarChar(120), caseNumber);
    });
    return rows?.[0] ? mapHistoricalCaseRow(rows[0], tableName) : null;
  };

  const good = await lookup("dbo.historical_case_good");
  if (good) return good;
  return lookup("dbo.historical_case_bad");
}

async function azureListHistoricalCases(filters = {}) {
  const limit = Math.max(1, Math.min(Number(filters.limit || 60), 250));
  const statusFilter = String(filters.status || "").trim();
  const categoryFilter = String(filters.category || "").trim();
  const searchFilter = cleanText(filters.search || "", 120);
  const baseQuery = `
    SELECT TOP (${limit})
      case_number, category, category_slug, rating, case_status, user_comment, expert_decision, expert_rating,
      reviewer_name, learning_eligible, reference_type, created_at, updated_at, reviewed_at, pdf_name
    FROM __TABLE__
    WHERE 1 = 1
      ${statusFilter ? "AND case_status = @statusFilter" : ""}
      ${categoryFilter ? "AND category = @categoryFilter" : ""}
      ${searchFilter ? "AND (case_number LIKE @searchFilter OR category LIKE @searchFilter OR user_comment LIKE @searchFilter OR expert_comment LIKE @searchFilter)" : ""}
  `;
  const bind = (request) => {
    if (statusFilter) request.input("statusFilter", sql.NVarChar(60), statusFilter);
    if (categoryFilter) request.input("categoryFilter", sql.NVarChar(120), categoryFilter);
    if (searchFilter) request.input("searchFilter", sql.NVarChar(160), `%${searchFilter}%`);
  };
  const [goodRows, badRows] = await Promise.all([
    azureQuery(`${baseQuery.replace("__TABLE__", "dbo.historical_case_good")} ORDER BY updated_at DESC;`, bind),
    azureQuery(`${baseQuery.replace("__TABLE__", "dbo.historical_case_bad")} ORDER BY updated_at DESC;`, bind)
  ]);
  return [...goodRows, ...badRows]
    .map((item) => ({
      caseNumber: item.case_number,
      category: item.category,
      categorySlug: item.category_slug,
      rating: item.rating,
      caseStatus: item.case_status || CASE_STATUS.AI_GENERATED,
      userComment: item.user_comment || "",
      expertDecision: item.expert_decision || "",
      expertRating: item.expert_rating || "",
      reviewerName: item.reviewer_name || "",
      learningEligible: !!item.learning_eligible,
      referenceType: item.reference_type || "",
      createdAt: item.created_at || "",
      updatedAt: item.updated_at || item.created_at || "",
      reviewedAt: item.reviewed_at || "",
      pdfName: item.pdf_name || ""
    }))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0));
}

async function azureUpdateExpertReview(caseNumber, payload) {
  const currentCase = await azureFindHistoricalCase(caseNumber);
  if (!currentCase) {
    throw new Error("Case not found.");
  }
  const { learningEligible, referenceType } = deriveReferenceMeta(payload.caseStatus);
  await azureQuery(`
    UPDATE ${currentCase.sourceTable}
    SET
      case_status = @caseStatus,
      expert_decision = @expertDecision,
      expert_rating = @expertRating,
      expert_comment = @expertComment,
      corrected_recommendation = @correctedRecommendation,
      knowledge_value = @knowledgeValue,
      reviewer_name = @reviewerName,
      learning_eligible = @learningEligible,
      reference_type = @referenceType,
      reviewed_at = @reviewedAt,
      updated_at = SYSUTCDATETIME()
    WHERE case_number = @caseNumber;
  `, (request) => {
    request.input("caseNumber", sql.NVarChar(120), caseNumber);
    request.input("caseStatus", sql.NVarChar(60), payload.caseStatus);
    request.input("expertDecision", sql.NVarChar(60), payload.caseStatus);
    request.input("expertRating", sql.NVarChar(40), payload.expertRating || "");
    request.input("expertComment", sql.NVarChar(sql.MAX), payload.expertComment || "");
    request.input("correctedRecommendation", sql.NVarChar(sql.MAX), payload.correctedRecommendation || "");
    request.input("knowledgeValue", sql.NVarChar(20), payload.knowledgeValue || "");
    request.input("reviewerName", sql.NVarChar(255), payload.reviewerName || "");
    request.input("learningEligible", sql.Bit, learningEligible ? 1 : 0);
    request.input("referenceType", sql.NVarChar(20), referenceType);
    request.input("reviewedAt", sql.DateTime2, new Date());
  });
  return azureFindHistoricalCase(caseNumber);
}

const db = {
  mode: () => getStorageMode(),
  hasStructuredStorage: () => getStorageMode() !== "local",
  reserveNextCaseNumberAzure: azureReserveNextCaseNumber,
  insertHistoricalCaseAzure: azureInsertHistoricalCase,
  insertAiRunAzure: azureInsertAiRun,
  insertAppEventAzure: azureInsertAppEvent,
  insertEvalCaseAzure: azureInsertEvalCase,
  upsertProductCatalog: async (products) => {
    if (hasAzureSql()) return azureUpsertProductCatalog(products);
    return Promise.reject(new Error("Azure SQL product catalog adapter unavailable."));
  },
  deactivateMissingProducts: async (categorySlug, seenUrls) => {
    if (hasAzureSql()) return azureDeactivateMissingProducts(categorySlug, seenUrls);
    return Promise.reject(new Error("Azure SQL product catalog adapter unavailable."));
  },
  saveProductSyncRun: async (entry) => {
    if (hasAzureSql()) return azureSaveProductSyncRun(entry);
    return Promise.reject(new Error("Azure SQL sync run adapter unavailable."));
  },
  fetchCatalogProductsByCategory: async (categorySlug, limit) => {
    if (hasAzureSql()) return azureFetchCatalogProductsByCategory(categorySlug, limit);
    return Promise.reject(new Error("Azure SQL catalog fetch adapter unavailable."));
  },
  findHistoricalCase: async (caseNumber) => {
    if (hasAzureSql()) return azureFindHistoricalCase(caseNumber);
    return null;
  },
  listHistoricalCases: async (filters) => {
    if (hasAzureSql()) return azureListHistoricalCases(filters);
    return [];
  },
  updateExpertReview: async (caseNumber, payload) => {
    if (hasAzureSql()) return azureUpdateExpertReview(caseNumber, payload);
    return null;
  }
};

async function logAiRun(entry) {
  const record = {
    request_id: entry.requestId,
    case_number: entry.caseNumber || "",
    category: entry.category || "",
    category_slug: slugify(entry.category || ""),
    user_name: entry.userName || "",
    model: entry.model || "",
    prompt_version: entry.promptVersion || promptVersion,
    status: entry.status || "unknown",
    latency_ms: Number(entry.latencyMs || 0),
    input_chars: Number(entry.inputChars || 0),
    usage_json: entry.usage || {},
    error_message: cleanText(entry.errorMessage || "", 800),
    source: entry.source || "web",
    recommendation_json: entry.recommendation || null,
    created_at: new Date().toISOString()
  };

  if (hasAzureSql()) {
    try {
      await db.insertAiRunAzure(record);
      return record;
    } catch (err) {
      cappedPush(localAiRunLogs, record);
      return record;
    }
  }
  cappedPush(localAiRunLogs, record);
  return record;
}

async function logAppEvent(entry) {
  const record = {
    event_name: cleanText(entry.eventName || "event", 120),
    event_detail: cleanText(entry.eventDetail || "", 800),
    level: cleanText(entry.level || "info", 20),
    case_number: entry.caseNumber || "",
    category: entry.category || "",
    category_slug: slugify(entry.category || ""),
    request_id: entry.requestId || "",
    created_at: new Date().toISOString()
  };

  if (hasAzureSql()) {
    try {
      await db.insertAppEventAzure(record);
      return record;
    } catch (err) {
      cappedPush(localAppEventLogs, record);
      return record;
    }
  }
  cappedPush(localAppEventLogs, record);
  return record;
}

async function saveEvalCase(payload) {
  const record = {
    case_number: payload.caseNumber,
    category: payload.category || "Other",
    category_slug: slugify(payload.category || "Other"),
    user_name: payload.userName || "",
    rating: payload.rating || "",
    evaluation_note: payload.evaluationNote || "",
    source_run_request_id: payload.sourceRunRequestId || "",
    case_payload: payload.casePayload || {},
    ai_response: payload.aiResponse || {},
    created_at: new Date().toISOString()
  };

  if (hasAzureSql()) {
    try {
      await db.insertEvalCaseAzure(record);
      return { saved: true, message: "Saved to evaluation set.", record };
    } catch (err) {
      cappedPush(localEvalCases, record);
      return { saved: true, message: "Saved to local evaluation set fallback.", record };
    }
  }
  cappedPush(localEvalCases, record);
  return { saved: true, message: "Saved to local evaluation set.", record };
}

function summarizeRunForUi(item) {
  return {
    request_id: item.request_id,
    case_number: item.case_number,
    category: item.category,
    user_name: item.user_name,
    model: item.model,
    prompt_version: item.prompt_version,
    status: item.status,
    latency_ms: item.latency_ms,
    input_chars: item.input_chars,
    usage_json: item.usage_json,
    error_message: item.error_message,
    created_at: item.created_at
  };
}

let localCaseSequence = 0;
const localCategorySequences = new Map();

async function reserveNextCaseNumber(category) {
  const categorySlug = slugify(category);
  const sequenceKey = `case_number_${categorySlug}`;
  if (hasAzureSql()) {
    return db.reserveNextCaseNumberAzure(category);
  }
  const nextValue = Number(localCategorySequences.get(sequenceKey) || 0) + 1;
  localCategorySequences.set(sequenceKey, nextValue);
  localCaseSequence = Math.max(localCaseSequence, nextValue);
  return {
    caseNumber: formatCaseNumber(categorySlug, nextValue),
    source: "local"
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
  if (!db.hasStructuredStorage()) {
    throw new Error("Structured storage must be configured before catalog sync can run.");
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
      db,
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
  if (hasAzureSql()) {
    return db.insertHistoricalCaseAzure(payload);
  }
  return {
    saved: false,
    message: "Azure SQL is not configured yet, so the historical case was not stored."
  };
}

async function getAdminRuns(limit = 12) {
  if (hasAzureSql()) {
    try {
      const rows = await azureTopRows("dbo.ai_run_logs", "request_id, case_number, category, user_name, model, prompt_version, status, latency_ms, input_chars, usage_json, error_message, created_at", limit);
      return rows.map((item) => ({
        ...item,
        usage_json: parseJsonText(item.usage_json, {})
      }));
    } catch (err) {
      return localAiRunLogs.slice(0, limit).map(summarizeRunForUi);
    }
  }
  return localAiRunLogs.slice(0, limit).map(summarizeRunForUi);
}

async function getAdminEvents(limit = 12) {
  if (hasAzureSql()) {
    try {
      return azureTopRows("dbo.app_event_logs", "event_name, event_detail, level, case_number, category, request_id, created_at", limit);
    } catch (err) {
      return localAppEventLogs.slice(0, limit);
    }
  }
  return localAppEventLogs.slice(0, limit);
}

async function getEvalCases(limit = 12) {
  if (hasAzureSql()) {
    try {
      return azureTopRows("dbo.eval_cases", "case_number, category, user_name, rating, evaluation_note, source_run_request_id, created_at", limit);
    } catch (err) {
      return localEvalCases.slice(0, limit);
    }
  }
  return localEvalCases.slice(0, limit);
}

async function getAdminSummary() {
  if (hasAzureSql()) {
    try {
      const [goodCount, badCount, productCount, runCount, eventCount, evalCount, recentRuns, recentEvents, recentEvalCases, caseItems] = await Promise.all([
        azureCount("dbo.historical_case_good"),
        azureCount("dbo.historical_case_bad"),
        azureCount("dbo.product_catalog"),
        azureCount("dbo.ai_run_logs"),
        azureCount("dbo.app_event_logs"),
        azureCount("dbo.eval_cases"),
        getAdminRuns(6),
        getAdminEvents(6),
        getEvalCases(6),
        azureListHistoricalCases({ limit: 200 })
      ]);
      const successRuns = recentRuns.filter((item) => item.status === "success");
      const avgLatencyMs = successRuns.length
        ? Math.round(successRuns.reduce((sum, item) => sum + Number(item.latency_ms || 0), 0) / successRuns.length)
        : 0;
      const statusCounts = caseItems.reduce((acc, item) => {
        const key = item.caseStatus || CASE_STATUS.AI_GENERATED;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});
      return {
        promptVersion,
        storageMode: "azure-sql",
        totals: {
          aiRuns: runCount,
          successfulRuns: successRuns.length,
          failedRuns: recentRuns.filter((item) => item.status !== "success").length,
          eventLogs: eventCount,
          evalCases: evalCount,
          goodCases: goodCount,
          badCases: badCount,
          productCatalogItems: productCount
        },
        statusCounts,
        avgLatencyMs,
        lastSyncState: catalogSyncState,
        recentRuns,
        recentEvents,
        recentEvalCases
      };
    } catch (err) {
      return {
        promptVersion,
        storageMode: "azure-sql-partial",
        totals: {
          aiRuns: localAiRunLogs.length,
          successfulRuns: localAiRunLogs.filter((item) => item.status === "success").length,
          failedRuns: localAiRunLogs.filter((item) => item.status !== "success").length,
          eventLogs: localAppEventLogs.length,
          evalCases: localEvalCases.length,
          goodCases: 0,
          badCases: 0,
          productCatalogItems: 0
        },
        avgLatencyMs: localAiRunLogs.length
          ? Math.round(localAiRunLogs.reduce((sum, item) => sum + Number(item.latency_ms || 0), 0) / localAiRunLogs.length)
          : 0,
        lastSyncState: catalogSyncState,
        recentRuns: localAiRunLogs.slice(0, 6).map(summarizeRunForUi),
        recentEvents: localAppEventLogs.slice(0, 6),
        recentEvalCases: localEvalCases.slice(0, 6)
      };
    }
  }
  const successRuns = localAiRunLogs.filter((item) => item.status === "success");
  const failedRuns = localAiRunLogs.filter((item) => item.status !== "success");
  const avgLatencyMs = successRuns.length
    ? Math.round(successRuns.reduce((sum, item) => sum + Number(item.latency_ms || 0), 0) / successRuns.length)
    : 0;
  return {
    promptVersion,
    storageMode: "local",
    totals: {
      aiRuns: localAiRunLogs.length,
      successfulRuns: successRuns.length,
      failedRuns: failedRuns.length,
      eventLogs: localAppEventLogs.length,
      evalCases: localEvalCases.length,
      goodCases: 0,
      badCases: 0,
      productCatalogItems: 0
    },
    avgLatencyMs,
    lastSyncState: catalogSyncState,
    recentRuns: localAiRunLogs.slice(0, 6),
    recentEvents: localAppEventLogs.slice(0, 6),
    recentEvalCases: localEvalCases.slice(0, 6)
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

app.post("/api/client-event", async (req, res) => {
  try {
    const body = req.body || {};
    await logAppEvent({
      eventName: body.eventName,
      eventDetail: body.eventDetail,
      level: body.level,
      caseNumber: body.caseNumber,
      category: body.category,
      requestId: body.requestId
    });
    return res.json({ saved: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to save client event." });
  }
});

app.post("/api/evals", async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.caseNumber) {
      return res.status(400).json({ error: "caseNumber is required." });
    }
    return res.json(await saveEvalCase(body));
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to save evaluation case." });
  }
});

app.get("/api/cases", async (req, res) => {
  try {
    if (!hasAzureSql()) {
      return res.json({ items: [] });
    }
    const items = await db.listHistoricalCases({
      limit: req.query.limit,
      status: req.query.status,
      category: req.query.category,
      search: req.query.search
    });
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to load case report." });
  }
});

app.get("/api/cases/:caseNumber", async (req, res) => {
  try {
    if (!hasAzureSql()) {
      return res.status(404).json({ error: "Structured storage is not configured." });
    }
    const item = await db.findHistoricalCase(String(req.params.caseNumber || "").trim());
    if (!item) {
      return res.status(404).json({ error: "Case not found." });
    }
    return res.json({ item });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to load case details." });
  }
});

app.post("/api/cases/:caseNumber/expert-review", async (req, res) => {
  try {
    if (!hasAzureSql()) {
      return res.status(400).json({ error: "Structured storage is not configured." });
    }
    const body = req.body || {};
    const caseStatus = String(body.caseStatus || "").trim();
    const allowedStatuses = [
      CASE_STATUS.VERIFIED_GOOD,
      CASE_STATUS.VERIFIED_CORRECTED,
      CASE_STATUS.VERIFIED_REJECTED,
      CASE_STATUS.ARCHIVED
    ];
    if (!allowedStatuses.includes(caseStatus)) {
      return res.status(400).json({ error: "A verified case status is required." });
    }
    if (!String(body.expertComment || "").trim()) {
      return res.status(400).json({ error: "Expert comment is required." });
    }
    if (caseStatus === CASE_STATUS.VERIFIED_CORRECTED && !String(body.correctedRecommendation || "").trim()) {
      return res.status(400).json({ error: "Corrected recommendation is required for Verified - Corrected." });
    }
    const item = await db.updateExpertReview(String(req.params.caseNumber || "").trim(), {
      caseStatus,
      expertRating: String(body.expertRating || "").trim(),
      expertComment: cleanLargeText(body.expertComment || "", 6000),
      correctedRecommendation: cleanLargeText(body.correctedRecommendation || "", 6000),
      knowledgeValue: cleanText(body.knowledgeValue || "", 20),
      reviewerName: cleanText(body.reviewerName || "", 255)
    });
    return res.json({ saved: true, item });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to save expert review." });
  }
});

app.get("/api/admin/summary", async (req, res) => {
  try {
    return res.json(await getAdminSummary());
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to load admin summary." });
  }
});

app.get("/api/admin/runs", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    return res.json({ items: await getAdminRuns(limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to load AI runs." });
  }
});

app.get("/api/admin/events", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    return res.json({ items: await getAdminEvents(limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to load app events." });
  }
});

app.get("/api/admin/evals", async (req, res) => {
  try {
    const limit = Number(req.query.limit || 20);
    return res.json({ items: await getEvalCases(limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Unable to load evaluation cases." });
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
  const requestStartedAt = Date.now();
  const requestId = randomUUID();
  let model = "";
  let caseContext = {};
  let aiProvider = "openai";
  try {
    const openAiApiKey = process.env.OPENAI_API_KEY;
    if (!hasAzureOpenAi() && !openAiApiKey) {
      return res.status(400).json({ error: "No AI provider is configured on backend. Set Azure OpenAI or OPENAI_API_KEY." });
    }

    const body = req.body || {};
    caseContext = body.caseContext || {};
    const similarCases = await fetchSimilarHistoricalCases(caseContext);
    model = body.model || chooseModel(body);
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

    let providerModel = model;
    let endpointUrl = "https://api.openai.com/v1/responses";
    let headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiApiKey}`
    };

    if (hasAzureOpenAi()) {
      aiProvider = "azure-openai";
      providerModel = resolveAzureDeployment(model);
      requestBody.model = providerModel;
      endpointUrl = buildAzureOpenAiUrl();
      headers = {
        "Content-Type": "application/json",
        "api-key": azureOpenAiApiKey
      };
    }

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });

    const data = await response.json();
    if (!response.ok) {
      await logAiRun({
        requestId,
        caseNumber: caseContext?.caseNumber || caseContext?.formData?.caseNumber || "",
        category: caseContext?.category || "",
        userName: caseContext?.user || caseContext?.formData?.user || "",
        model,
        promptVersion,
        status: "error",
        latencyMs: Date.now() - requestStartedAt,
        inputChars: JSON.stringify(requestBody || {}).length,
        usage: summarizeUsage(data?.usage),
        errorMessage: data?.error?.message || `${aiProvider} request failed (${response.status}).`
      }).catch((logErr) => {
        console.warn(`[ai-run-log] failed to store error run: ${logErr.message}`);
      });
      return res.status(response.status).json(data);
    }

    const analysisMeta = {
      requestId,
      promptVersion,
      model,
      providerModel,
      provider: aiProvider,
      latencyMs: Date.now() - requestStartedAt,
      usage: summarizeUsage(data?.usage),
      referencedCaseCount: similarCases.length
    };

    await logAiRun({
      requestId,
      caseNumber: caseContext?.caseNumber || caseContext?.formData?.caseNumber || "",
      category: caseContext?.category || "",
      userName: caseContext?.user || caseContext?.formData?.user || "",
      model,
      promptVersion,
      status: "success",
      latencyMs: analysisMeta.latencyMs,
      inputChars: JSON.stringify(requestBody || {}).length,
      usage: analysisMeta.usage,
      recommendation: data,
      errorMessage: ""
    }).catch((logErr) => {
      console.warn(`[ai-run-log] failed to store success run: ${logErr.message}`);
    });

    return res.json({
      ...data,
      retrieved_case_numbers: similarCases.map((item) => item.case_number),
      analysis_meta: analysisMeta
    });
  } catch (err) {
    await logAiRun({
      requestId,
      caseNumber: caseContext?.caseNumber || caseContext?.formData?.caseNumber || "",
      category: caseContext?.category || "",
      userName: caseContext?.user || caseContext?.formData?.user || "",
      model,
      promptVersion,
      status: "error",
      latencyMs: Date.now() - requestStartedAt,
      inputChars: JSON.stringify(req.body || {}).length,
      usage: {},
      errorMessage: err.message || "Server error."
    }).catch((logErr) => {
      console.warn(`[ai-run-log] failed to store catch run: ${logErr.message}`);
    });
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
  if (catalogSyncEnabled && db.hasStructuredStorage()) {
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

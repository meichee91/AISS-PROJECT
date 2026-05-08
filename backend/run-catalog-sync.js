require("dotenv").config();

const { syncCatalogProducts } = require("./catalog-sync");
const { sendSyncEmail } = require("./email-notifier");

const supabaseUrl = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const supabaseKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "");
const maxPagesPerCategory = Math.max(0, Number(process.env.CATALOG_SYNC_MAX_PAGES_PER_CATEGORY || 0));
const categoriesFromArgs = process.argv.slice(2).map((item) => String(item || "").trim()).filter(Boolean);

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

async function supabaseRequest(resource, options = {}) {
  const { method = "GET", body, upsert = false, onConflict } = options;
  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`
  };

  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (upsert) headers.Prefer = "resolution=merge-duplicates,return=representation";

  const url = new URL(`${supabaseUrl}/rest/v1/${resource}`);
  if (onConflict) {
    url.searchParams.set("on_conflict", onConflict);
  }

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Supabase request failed (${response.status}).`);
  }
  return data;
}

async function main() {
  try {
    const summary = await syncCatalogProducts({
      supabaseRequest,
      categoriesFilter: categoriesFromArgs.length ? categoriesFromArgs : undefined,
      maxPagesPerCategory,
      logger: console
    });
    const payload = {
      trigger: categoriesFromArgs.length ? `manual:${categoriesFromArgs.join(",")}` : "manual",
      ...summary,
      finishedAt: new Date().toISOString()
    };
    await sendSyncEmail("success", payload).catch((err) => {
      console.warn(`success email failed: ${err.message}`);
    });
    console.log(JSON.stringify(payload, null, 2));
  } catch (err) {
    await sendSyncEmail("failure", {
      trigger: categoriesFromArgs.length ? `manual:${categoriesFromArgs.join(",")}` : "manual",
      error: err.message || String(err)
    }).catch((emailErr) => {
      console.warn(`failure email failed: ${emailErr.message}`);
    });
    throw err;
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

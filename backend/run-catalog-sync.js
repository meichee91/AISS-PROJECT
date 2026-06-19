require("dotenv").config();

const sql = require("mssql");
const { syncCatalogProducts } = require("./catalog-sync");
const { sendSyncEmail } = require("./email-notifier");

const azureSqlServer = String(process.env.AZURE_SQL_SERVER || "").trim();
const azureSqlDatabase = String(process.env.AZURE_SQL_DATABASE || "").trim();
const azureSqlUser = String(process.env.AZURE_SQL_USER || "").trim();
const azureSqlPassword = String(process.env.AZURE_SQL_PASSWORD || "");
const azureSqlEncrypt = String(process.env.AZURE_SQL_ENCRYPT || "true").toLowerCase() !== "false";
const azureSqlTrustServerCertificate = String(process.env.AZURE_SQL_TRUST_SERVER_CERTIFICATE || "false").toLowerCase() === "true";
const maxPagesPerCategory = Math.max(0, Number(process.env.CATALOG_SYNC_MAX_PAGES_PER_CATEGORY || 0));
const categoriesFromArgs = process.argv.slice(2).map((item) => String(item || "").trim()).filter(Boolean);
let azureSqlPoolPromise = null;

if (!azureSqlServer || !azureSqlDatabase || !azureSqlUser || !azureSqlPassword) {
  throw new Error("AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USER, and AZURE_SQL_PASSWORD are required.");
}

async function getAzureSqlPool() {
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
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000
      }
    });
  }
  return azureSqlPoolPromise;
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

async function upsertProductCatalog(products) {
  for (const item of products) {
    await azureQuery(`
      MERGE dbo.product_catalog AS target
      USING (SELECT @productUrl AS product_url) AS source
      ON target.product_url = source.product_url
      WHEN MATCHED THEN
        UPDATE SET
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
          last_synced_at = @lastSyncedAt,
          updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (
          app_category, app_category_slug, source_type, source_label, source_url,
          product_name, product_slug, sku, brand, product_url, price_text, currency,
          availability, short_description, specs_json, category_trail, searchable_text,
          is_active, source_updated_at, last_synced_at, created_at, updated_at
        )
        VALUES (
          @appCategory, @appCategorySlug, @sourceType, @sourceLabel, @sourceUrl,
          @productName, @productSlug, @sku, @brand, @productUrl, @priceText, @currency,
          @availability, @shortDescription, @specsJson, @categoryTrail, @searchableText,
          @isActive, @sourceUpdatedAt, @lastSyncedAt, SYSUTCDATETIME(), SYSUTCDATETIME()
        );
    `, (request) => {
      request.input("appCategory", sql.NVarChar(120), item.app_category);
      request.input("appCategorySlug", sql.NVarChar(120), item.app_category_slug);
      request.input("sourceType", sql.NVarChar(40), item.source_type);
      request.input("sourceLabel", sql.NVarChar(200), item.source_label);
      request.input("sourceUrl", sql.NVarChar(sql.MAX), item.source_url);
      request.input("productName", sql.NVarChar(400), item.product_name);
      request.input("productSlug", sql.NVarChar(200), item.product_slug);
      request.input("sku", sql.NVarChar(200), item.sku || null);
      request.input("brand", sql.NVarChar(160), item.brand || null);
      request.input("productUrl", sql.NVarChar(sql.MAX), item.product_url);
      request.input("priceText", sql.NVarChar(80), item.price_text || null);
      request.input("currency", sql.NVarChar(16), item.currency || null);
      request.input("availability", sql.NVarChar(40), item.availability || null);
      request.input("shortDescription", sql.NVarChar(sql.MAX), item.short_description || null);
      request.input("specsJson", sql.NVarChar(sql.MAX), JSON.stringify(item.specs_json || {}));
      request.input("categoryTrail", sql.NVarChar(sql.MAX), JSON.stringify(item.category_trail || []));
      request.input("searchableText", sql.NVarChar(sql.MAX), item.searchable_text || null);
      request.input("isActive", sql.Bit, item.is_active !== false);
      request.input("sourceUpdatedAt", sql.DateTime2, item.source_updated_at ? new Date(item.source_updated_at) : new Date());
      request.input("lastSyncedAt", sql.DateTime2, item.last_synced_at ? new Date(item.last_synced_at) : new Date());
    });
  }
}

async function deactivateMissingProducts(categorySlug, seenUrls) {
  let queryText = `
    UPDATE dbo.product_catalog
    SET is_active = 0, last_synced_at = SYSUTCDATETIME()
    WHERE app_category_slug = @categorySlug
  `;
  if (seenUrls.length) {
    const placeholders = seenUrls.map((_, index) => `@seenUrl${index}`).join(", ");
    queryText += ` AND product_url NOT IN (${placeholders})`;
  }
  await azureQuery(queryText, (request) => {
    request.input("categorySlug", sql.NVarChar(120), categorySlug);
    seenUrls.forEach((url, index) => request.input(`seenUrl${index}`, sql.NVarChar(sql.MAX), url));
  });
}

async function saveProductSyncRun(entry) {
  await azureQuery(`
    MERGE dbo.product_sync_runs AS target
    USING (SELECT @runId AS run_id) AS source
    ON target.run_id = source.run_id
    WHEN MATCHED THEN
      UPDATE SET
        sync_scope = @syncScope,
        status = @status,
        details = @details,
        started_at = @startedAt,
        finished_at = @finishedAt
    WHEN NOT MATCHED THEN
      INSERT (run_id, sync_scope, status, details, started_at, finished_at)
      VALUES (@runId, @syncScope, @status, @details, @startedAt, @finishedAt);
  `, (request) => {
    request.input("runId", sql.NVarChar(160), entry.runId);
    request.input("syncScope", sql.NVarChar(120), entry.syncScope || "manual_catalog");
    request.input("status", sql.NVarChar(40), entry.status || "completed");
    request.input("details", sql.NVarChar(sql.MAX), JSON.stringify(entry.details || {}));
    request.input("startedAt", sql.DateTime2, entry.startedAt ? new Date(entry.startedAt) : null);
    request.input("finishedAt", sql.DateTime2, entry.finishedAt ? new Date(entry.finishedAt) : null);
  });
}

async function main() {
  try {
    const summary = await syncCatalogProducts({
      db: {
        upsertProductCatalog,
        deactivateMissingProducts,
        saveProductSyncRun
      },
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

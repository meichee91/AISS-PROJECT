const SHOP_BASE_URL = "https://shop.slsbearings.com";
const SHOP_ROOT = `${SHOP_BASE_URL}/my/west-malaysia`;
const PAGE_SIZE = 72;

const CATALOG_SOURCES = [
  {
    appCategory: "Belt",
    sourceType: "category",
    label: "V-Belts",
    url: `${SHOP_ROOT}/mechanical/industrial-belts/v-belts.html`
  },
  {
    appCategory: "Belt",
    sourceType: "category",
    label: "Timing Belts Rubber",
    url: `${SHOP_ROOT}/mechanical/industrial-belts/timing-belts-rubber.html`
  },
  {
    appCategory: "Belt",
    sourceType: "category",
    label: "Timing Belts PU",
    url: `${SHOP_ROOT}/mechanical/industrial-belts/timing-belts-pu.html`
  },
  {
    appCategory: "Belt",
    sourceType: "category",
    label: "Ribbed Belts",
    url: `${SHOP_ROOT}/mechanical/industrial-belts/ribbed-belts.html`
  },
  {
    appCategory: "Belt",
    sourceType: "search",
    label: "Automotive Belt",
    query: "\"automotive belt\""
  },
  {
    appCategory: "Belt",
    sourceType: "search",
    label: "Fan Belt",
    query: "\"fan belt\""
  },
  {
    appCategory: "Chain",
    sourceType: "category",
    label: "Chain and Sprockets",
    url: `${SHOP_ROOT}/mechanical/chain-and-sprockets.html`
  },
  {
    appCategory: "Coupling",
    sourceType: "search",
    label: "Coupling",
    query: "coupling"
  },
  {
    appCategory: "Gearbox",
    sourceType: "search",
    label: "Gear Unit",
    query: "\"gear unit\""
  },
  {
    appCategory: "Gearbox",
    sourceType: "search",
    label: "Gearmotor",
    query: "gearmotor"
  },
  {
    appCategory: "Gearbox",
    sourceType: "search",
    label: "Gear Motor",
    query: "\"gear motor\""
  },
  {
    appCategory: "Electric Motor",
    sourceType: "search",
    label: "Electric Motor",
    query: "\"electric motor\""
  }
];

const CATEGORY_HINTS = {
  belt: [
    "belt",
    "v-belt",
    "v belt",
    "timing belt",
    "ribbed belt",
    "fan belt",
    "serpentine",
    "automotive belt",
    "power ace",
    "metric v",
    "raw edge cogged",
    "powerband",
    "double v",
    "hexagonal belt",
    "pu belt"
  ],
  gearbox: [
    "gear unit",
    "gearmotor",
    "gear motor",
    "geared motor",
    "speed reducer",
    "reducer",
    "worm gear",
    "helical gear",
    "planetary gear",
    "emga"
  ],
  chain: [
    "roller chain",
    "connecting link",
    "offset link",
    "attachment chain",
    "sprocket",
    "chain"
  ],
  coupling: [
    "coupling",
    "jaw coupling",
    "grid coupling",
    "disc coupling",
    "flexible coupling"
  ],
  electric_motor: [
    "electric motor",
    "motor",
    "ac motor",
    "dc motor",
    "induction motor",
    "servo motor"
  ]
};

function slugify(value) {
  return String(value || "other")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "other";
}

function htmlDecode(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value) {
  return htmlDecode(String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch (err) {
    return fallback;
  }
}

function pageUrlFor(source, pageNumber) {
  const url = new URL(source.sourceType === "search"
    ? `${SHOP_ROOT}/catalogsearch/result/`
    : source.url);
  if (source.sourceType === "search") {
    url.searchParams.set("q", source.query);
  }
  url.searchParams.set("product_list_limit", String(PAGE_SIZE));
  if (pageNumber > 1) {
    url.searchParams.set("p", String(pageNumber));
  }
  return url.toString();
}

function normalizeProductUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url, SHOP_BASE_URL);
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/, "");
    const isSimpleProduct = /^\/my\/west-malaysia\/[^/?#]+\.html$/i.test(pathname);
    const isMagentoProduct = /^\/my\/west-malaysia\/catalog\/product\/view\/id\/\d+(?:\/.*)?$/i.test(pathname);
    if (!isSimpleProduct && !isMagentoProduct) return "";
    return `${parsed.origin}${pathname}`;
  } catch (err) {
    return "";
  }
}

function extractProductUrls(html) {
  const productItemMatches = [];
  const anchorRegex = /<a\b[^>]*class="[^"]*\bproduct-item-link\b[^"]*"[^>]*>/gi;
  let anchorMatch;
  while ((anchorMatch = anchorRegex.exec(html))) {
    const hrefMatch = anchorMatch[0].match(/\bhref="([^"]+)"/i);
    const normalized = normalizeProductUrl(hrefMatch?.[1] || "");
    if (normalized) {
      productItemMatches.push(normalized);
    }
  }
  if (productItemMatches.length) {
    return Array.from(new Set(productItemMatches));
  }

  const matches = new Set();
  const regex = /href="([^"]+)"/gi;
  let match;
  while ((match = regex.exec(html))) {
    const normalized = normalizeProductUrl(match[1]);
    if (normalized) matches.add(normalized);
  }
  return Array.from(matches);
}

function detectHasNextPage(html, pageNumber) {
  const pageText = stripHtml(html);
  return new RegExp(`Page\\s+${pageNumber + 1}\\b`, "i").test(pageText) || /Page Next/i.test(pageText);
}

function extractMetaDescription(html) {
  const match = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i);
  return match ? htmlDecode(match[1]).trim() : "";
}

function extractTitle(html) {
  const match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return match ? stripHtml(match[1]) : "";
}

function extractPrice(html) {
  const match = html.match(/RM\s?[\d,]+(?:\.\d{2})?/i);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

function extractSku(html) {
  const patterns = [
    /SKU[\s\S]{0,120}?<\/[^>]+>\s*<[^>]+>([\s\S]*?)<\/[^>]+>/i,
    /SKU[\s\S]{0,120}?([A-Z0-9][A-Z0-9\-./_ ]{2,})/i
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const value = stripHtml(match[1]).replace(/\s+/g, " ").trim();
      if (value && value.toUpperCase() !== "SKU") return value;
    }
  }
  return "";
}

function extractSpecs(html) {
  const specs = {};
  const tableMatch = html.match(/More Information[\s\S]*?<table[^>]*>([\s\S]*?)<\/table>/i);
  const block = tableMatch ? tableMatch[1] : "";
  if (!block) return specs;

  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let row;
  while ((row = rowRegex.exec(block))) {
    const cells = Array.from(row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((item) => stripHtml(item[1]));
    if (cells.length >= 2) {
      const key = cells[0].replace(/\s+/g, " ").trim();
      const value = cells[1].replace(/\s+/g, " ").trim();
      if (key && value) specs[key] = value;
    }
  }
  return specs;
}

function extractAvailability(html) {
  if (/Add to Cart/i.test(html)) return "available";
  if (/Out of stock/i.test(html)) return "out_of_stock";
  return "unknown";
}

function inferBrand(title, sku) {
  const titleBrand = String(title || "").trim().split(/\s+/)[0] || "";
  if (titleBrand && /^[A-Za-z0-9]+$/.test(titleBrand)) return titleBrand;
  const skuBrand = String(sku || "").trim().split("-").slice(-1)[0] || "";
  return skuBrand;
}

function extractCategoryTrail(html) {
  const crumbs = Array.from(html.matchAll(/class="breadcrumbs?[\s\S]*?<\/ul>/gi));
  const text = crumbs.length ? stripHtml(crumbs[0][0]) : "";
  return text ? text.split(/\s{2,}|\/|>/).map((item) => item.trim()).filter(Boolean) : [];
}

function extractCanonicalProductUrl(html, fallbackUrl) {
  const canonicalMatch = html.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i);
  const ogMatch = html.match(/property="og:url" content="([^"]+)"/i);
  return normalizeProductUrl(canonicalMatch?.[1] || ogMatch?.[1] || fallbackUrl) || normalizeProductUrl(fallbackUrl);
}

function productClassifierText(source, record) {
  return [
    record.product_name,
    record.sku,
    record.brand,
    record.short_description,
    ...(record.category_trail || []),
    ...Object.entries(record.specs_json || {}).flatMap(([key, value]) => [key, value])
  ].filter(Boolean).join(" ").toLowerCase();
}

function matchesCategoryHints(source, record) {
  const hints = CATEGORY_HINTS[slugify(source.appCategory)] || [];
  if (!hints.length) return true;
  const text = productClassifierText(source, record);
  return hints.some((hint) => text.includes(hint));
}

function buildProductRecord(source, url, html) {
  const title = extractTitle(html);
  const sku = extractSku(html);
  const description = extractMetaDescription(html);
  const specs = extractSpecs(html);
  const brand = inferBrand(title, sku);
  return {
    app_category: source.appCategory,
    app_category_slug: slugify(source.appCategory),
    source_type: source.sourceType,
    source_label: source.label,
    source_url: source.sourceType === "search" ? `${SHOP_ROOT}/catalogsearch/result/?q=${encodeURIComponent(source.query)}` : source.url,
    product_name: title,
    product_slug: slugify(title || sku || url),
    sku,
    brand,
    product_url: extractCanonicalProductUrl(html, url),
    price_text: extractPrice(html),
    currency: "MYR",
    availability: extractAvailability(html),
    short_description: description,
    specs_json: specs,
    category_trail: extractCategoryTrail(html),
    searchable_text: buildProductSearchText({
      product_name: title,
      sku,
      brand,
      short_description: description,
      specs_json: specs,
      app_category: source.appCategory,
      source_label: source.label
    }),
    is_active: true,
    source_updated_at: new Date().toISOString(),
    last_synced_at: new Date().toISOString()
  };
}

function buildProductSearchText(product) {
  const specText = Object.entries(product.specs_json || {}).map(([key, value]) => `${key} ${value}`).join(" ");
  return [
    product.app_category,
    product.source_label,
    product.product_name,
    product.sku,
    product.brand,
    product.short_description,
    specText
  ].filter(Boolean).join(" ").toLowerCase().replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function scoreProductAgainstCase(targetText, product) {
  const targetTokens = new Set(tokenize(targetText));
  const productTokens = new Set(tokenize(product.searchable_text || buildProductSearchText(product)));
  let score = 0;
  targetTokens.forEach((token) => {
    if (productTokens.has(token)) score += 1;
  });
  return score;
}

async function fetchHtml(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: {
      "User-Agent": "AISS Catalog Sync/1.0",
      "Accept-Language": "en-US,en;q=0.9"
    }
  });
  if (!response.ok) {
    throw new Error(`Catalog fetch failed for ${url} (${response.status}).`);
  }
  return response.text();
}

async function syncCatalogProducts({
  supabaseRequest,
  fetchImpl = fetch,
  logger = console,
  categoriesFilter,
  maxPagesPerCategory = 0,
  productFetchConcurrency = 8
}) {
  const selected = Array.isArray(categoriesFilter) && categoriesFilter.length
    ? CATALOG_SOURCES.filter((item) => categoriesFilter.includes(item.appCategory))
    : CATALOG_SOURCES;

  const syncStartedAt = new Date().toISOString();
  const runId = `catalog_sync_${Date.now()}`;
  const seenUrlsByCategory = new Map();
  const summary = {
    runId,
    startedAt: syncStartedAt,
    categories: [],
    totalProductsSeen: 0,
    totalProductsUpserted: 0
  };

  for (const source of selected) {
    const seenProductUrls = new Set();
    let page = 1;
    let keepGoing = true;

    logger.log(`[catalog-sync] ${source.appCategory}: starting from ${source.label}`);

    while (keepGoing) {
      if (maxPagesPerCategory > 0 && page > maxPagesPerCategory) break;
      const pageUrl = pageUrlFor(source, page);
      const html = await fetchHtml(pageUrl, fetchImpl);
      const productUrls = extractProductUrls(html);
      let newUrls = 0;
      productUrls.forEach((url) => {
        if (!seenProductUrls.has(url)) {
          seenProductUrls.add(url);
          newUrls += 1;
        }
      });
      logger.log(`[catalog-sync] ${source.appCategory}: page ${page} -> ${productUrls.length} products (${newUrls} new)`);

      if (!productUrls.length) break;
      if (!newUrls) break;
      if (!detectHasNextPage(html, page)) break;
      page += 1;
    }

    const productUrls = Array.from(seenProductUrls);
    const products = [];
    const uniqueProducts = new Map();
    for (let i = 0; i < productUrls.length; i += productFetchConcurrency) {
      const batch = productUrls.slice(i, i + productFetchConcurrency);
      const results = await Promise.all(batch.map(async (productUrl) => {
        try {
          const html = await fetchHtml(productUrl, fetchImpl);
          return buildProductRecord(source, productUrl, html);
        } catch (err) {
          logger.warn(`[catalog-sync] ${source.appCategory}: failed product ${productUrl} -> ${err.message}`);
          return null;
        }
      }));
      results.forEach((record) => {
        if (record?.product_name) {
          uniqueProducts.set(record.product_url, record);
        }
      });
      logger.log(`[catalog-sync] ${source.appCategory}: product details ${Math.min(i + batch.length, productUrls.length)}/${productUrls.length}`);
    }
    products.push(...uniqueProducts.values().filter((record) => matchesCategoryHints(source, record)));

    const categoryKey = slugify(source.appCategory);
    if (!seenUrlsByCategory.has(categoryKey)) {
      seenUrlsByCategory.set(categoryKey, new Set());
    }
    const categorySeen = seenUrlsByCategory.get(categoryKey);
    products.forEach((record) => categorySeen.add(record.product_url));

    summary.categories.push({
      appCategory: source.appCategory,
      sourceLabel: source.label,
      productsSeen: seenProductUrls.size,
      productsUpserted: products.length
    });
    summary.totalProductsSeen += seenProductUrls.size;
    summary.totalProductsUpserted += products.length;

    if (products.length) {
      for (let i = 0; i < products.length; i += 200) {
        const chunk = products.slice(i, i + 200);
        await supabaseRequest("product_catalog", {
          method: "POST",
          upsert: true,
          onConflict: "product_url",
          body: chunk
        });
      }
    }
  }

  for (const [categoryKey, seenUrls] of seenUrlsByCategory.entries()) {
    await supabaseRequest(`product_catalog?app_category_slug=eq.${encodeURIComponent(categoryKey)}&product_url=not.in.(${Array.from(seenUrls).map((url) => `"${url}"`).join(",") || '""'})`, {
      method: "PATCH",
      body: {
        is_active: false,
        last_synced_at: new Date().toISOString()
      }
    }).catch((err) => {
      logger.warn(`[catalog-sync] ${categoryKey}: inactive mark skipped -> ${err.message}`);
    });
  }

  await supabaseRequest("product_sync_runs", {
    method: "POST",
    body: {
      run_id: summary.runId,
      sync_scope: "scheduled_catalog",
      status: "completed",
      details_json: summary,
      started_at: summary.startedAt,
      finished_at: new Date().toISOString()
    }
  }).catch((err) => {
    logger.warn(`[catalog-sync] run logging skipped -> ${err.message}`);
  });

  return summary;
}

async function fetchCatalogProductsForCase({ supabaseRequest, caseContext, limit = 5 }) {
  if (!caseContext?.category) return [];
  const appCategorySlug = slugify(caseContext.category);
  const rows = await supabaseRequest(
    `product_catalog?app_category_slug=eq.${encodeURIComponent(appCategorySlug)}&is_active=eq.true&select=product_name,sku,brand,product_url,price_text,currency,availability,short_description,specs_json,searchable_text,source_label,last_synced_at&limit=250`
  ).catch(() => []);

  const targetText = [
    caseContext.category,
    caseContext?.formData?.application,
    caseContext?.formData?.problem,
    caseContext?.formData?.additionalInfo,
    caseContext?.formData?.existing,
    caseContext?.formData?.type,
    caseContext?.formData?.environment,
    caseContext?.formData?.priority,
    ...(caseContext?.chatUpdates || []).map((item) => `${item.text || ""} ${(item.insights || []).join(" ")}`)
  ].join(" ");

  return (rows || [])
    .map((item) => ({
      ...item,
      score: scoreProductAgainstCase(targetText, item)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function catalogPrompt(products) {
  if (!products.length) {
    return "No synced shop products were found for this case category.";
  }
  const lines = products.map((item, index) => {
    const specs = Object.entries(item.specs_json || {}).slice(0, 6).map(([key, value]) => `${key}: ${value}`).join("; ");
    return `${index + 1}. ${item.product_name} | SKU: ${item.sku || "N/A"} | Brand: ${item.brand || "N/A"} | Price: ${item.price_text || "N/A"} | Availability: ${item.availability || "unknown"} | URL: ${item.product_url}${specs ? ` | Specs: ${specs}` : ""}`;
  });
  return [
    "Use these synced SLS shop products as the preferred recommendation pool.",
    "If they fit the case, prioritize them over generic suggestions and reference their exact product names or SKU codes.",
    ...lines
  ].join("\n");
}

module.exports = {
  CATALOG_SOURCES,
  SHOP_ROOT,
  slugify,
  syncCatalogProducts,
  fetchCatalogProductsForCase,
  catalogPrompt
};

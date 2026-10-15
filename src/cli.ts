import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CaptchaError, PoliteBrowser } from "./browser.ts";
import { writeCsv } from "./csv.ts";
import { AMAZON_SELLER, buildLeads, LEAD_HEADER, passesFilters, PRODUCT_HEADER, productLine, type Filters } from "./leads.ts";
import { isNotFound, parseProduct, parseSearch, parseSeller } from "./parse.ts";
import { loadState, saveState, type RunState } from "./state.ts";

const HELP = `
amazon_search_scraper: amazon.in search results -> seller lead list (CSV)

Usage:
  npm run scrape -- --keywords "yoga mat, resistance band" [options]
  npm run scrape -- --keywords-file keywords.txt [options]

Options:
  -k, --keywords <list>     Comma-separated search keywords
  -f, --keywords-file <p>   Text file, one keyword per line (# for comments)
  -p, --pages <n>           Search pages per keyword (default 3, about 20 products each)
  -o, --out <dir>           Output folder (default ./output)
      --headful             Show the browser; you can solve captchas yourself (recommended)
      --chrome              Use your installed Google Chrome instead of Playwright's Chromium
      --min-delay <s>       Minimum seconds between pages (default 4)
      --max-delay <s>       Maximum seconds between pages (default 9)
      --max-products <n>    Stop after this many new products in this run

  Filters (checked on the search card, before the product page is opened):
      --min-reviews <n>     --max-reviews <n>
      --min-price <inr>     --max-price <inr>
      --max-rating <x>      e.g. 4.0 to find listings that need help
      --sponsored-only      Only products shown as Sponsored (sellers already spending on ads)
      --include-amazon      Keep Amazon retail / Cloudtail / Appario (skipped by default)

      --fresh               Ignore saved progress and start over
  -h, --help

Output:
  <out>/leads.csv     one row per seller: business name, address, brands, manufacturers...
  <out>/products.csv  one row per product
  Progress is saved after every page; run the same command again to resume.
`;

const { values: a } = parseArgs({
  options: {
    keywords: { type: "string", short: "k" },
    "keywords-file": { type: "string", short: "f" },
    pages: { type: "string", short: "p", default: "3" },
    out: { type: "string", short: "o", default: "output" },
    headful: { type: "boolean", default: false },
    chrome: { type: "boolean", default: false },
    "min-delay": { type: "string", default: "4" },
    "max-delay": { type: "string", default: "9" },
    "max-products": { type: "string" },
    "min-reviews": { type: "string" },
    "max-reviews": { type: "string" },
    "min-price": { type: "string" },
    "max-price": { type: "string" },
    "max-rating": { type: "string" },
    "sponsored-only": { type: "boolean", default: false },
    "include-amazon": { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

// Only for the end-to-end test against a local mock; real runs always use amazon.in.
const BASE = process.env.AMAZON_BASE_URL ?? "https://www.amazon.in";
const optNum = (v: string | undefined) => (v === undefined ? undefined : Number(v));

function keywords(): string[] {
  const list: string[] = [];
  if (a.keywords) list.push(...a.keywords.split(","));
  if (a["keywords-file"]) list.push(...readFileSync(a["keywords-file"], "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("#")));
  return [...new Set(list.map((k) => k.trim()).filter(Boolean))];
}

async function main() {
  const kws = keywords();
  if (a.help || !kws.length) {
    console.log(HELP);
    process.exit(a.help ? 0 : 1);
  }
  const pages = Math.max(1, Number(a.pages));
  const outDir = resolve(a.out!);
  const statePath = join(outDir, "state.json");
  if (a.fresh && existsSync(statePath)) rmSync(statePath);
  const filters: Filters = {
    minReviews: optNum(a["min-reviews"]),
    maxReviews: optNum(a["max-reviews"]),
    minPrice: optNum(a["min-price"]),
    maxPrice: optNum(a["max-price"]),
    maxRating: optNum(a["max-rating"]),
    sponsoredOnly: a["sponsored-only"],
  };
  const maxProducts = optNum(a["max-products"]) ?? Infinity;
  const state = loadState(statePath);

  const flush = () => {
    saveState(statePath, state);
    const products = Object.values(state.products);
    writeCsv(join(outDir, "products.csv"), PRODUCT_HEADER, products.map(productLine));
    writeCsv(join(outDir, "leads.csv"), LEAD_HEADER, buildLeads(products, state.sellers));
  };

  const browser = new PoliteBrowser({
    headful: a.headful!,
    channel: a.chrome ? "chrome" : undefined,
    profileDir: join(outDir, "browser-profile"),
    minDelayMs: Number(a["min-delay"]) * 1000,
    maxDelayMs: Math.max(Number(a["min-delay"]), Number(a["max-delay"])) * 1000,
  });

  let stop = false;
  process.on("SIGINT", () => {
    if (stop) process.exit(130);
    stop = true;
    console.log("\nStopping after this page (Ctrl+C again to quit now)...");
  });

  const started = Object.keys(state.products).length;
  console.log(`Keywords: ${kws.length} · pages each: ${pages} · already saved: ${started} products, ${Object.keys(state.sellers).length} sellers`);
  let newProducts = 0;
  let exitCode = 0;
  try {
    await browser.start();
    // Sellers missed when a previous run stopped between a product and its seller page.
    for (const p of Object.values(state.products)) {
      if (stop) break;
      if (p.sellerId && !state.sellers[p.sellerId]) {
        state.sellers[p.sellerId] = parseSeller(await browser.get(`${BASE}/sp?seller=${p.sellerId}`), p.sellerId);
        saveState(statePath, state);
      }
    }
    outer: for (const kw of kws) {
      for (let pg = (state.keywordPages[kw] ?? 0) + 1; pg <= pages && !state.keywordDone[kw]; pg++) {
        if (stop || newProducts >= maxProducts) break outer;
        const url = `${BASE}/s?k=${encodeURIComponent(kw)}${pg > 1 ? `&page=${pg}` : ""}`;
        const { results, hasNext } = parseSearch(await browser.get(url));
        const fresh = results.filter((r) => !state.products[r.asin] && !state.skipped[r.asin]);
        console.log(`\n[${kw}] page ${pg}: ${results.length} results, ${fresh.length} new`);
        if (!results.length) console.log("  (no results parsed: Amazon may have changed its layout, or the keyword has no matches)");

        let finished = true;
        for (const r of fresh) {
          if (stop || newProducts >= maxProducts) {
            finished = false;
            break;
          }
          if (!passesFilters(r, filters)) {
            state.skipped[r.asin] = "filter";
            continue;
          }
          const html = await browser.get(`${BASE}/dp/${r.asin}?th=1&psc=1`);
          if (isNotFound(html)) {
            state.skipped[r.asin] = "not found";
            continue;
          }
          const p = parseProduct(html, r.asin);
          if (!p.sellerId || (!a["include-amazon"] && AMAZON_SELLER.test(p.sellerName ?? ""))) {
            state.skipped[r.asin] = p.sellerId ? `amazon: ${p.sellerName}` : "no third-party seller";
            console.log(`  - ${r.asin} skipped (${state.skipped[r.asin]})`);
            continue;
          }
          state.products[r.asin] = { ...p, keyword: kw, searchPage: pg, position: r.position, sponsored: r.sponsored, scrapedAt: new Date().toISOString() };
          newProducts++;

          if (!state.sellers[p.sellerId]) {
            state.sellers[p.sellerId] = parseSeller(await browser.get(`${BASE}/sp?seller=${p.sellerId}`), p.sellerId);
          }
          const s = state.sellers[p.sellerId];
          console.log(`  + ${r.asin} ${p.brand ?? "?"} · ${s.businessName ?? p.sellerName ?? "?"}${s.city ? ` (${s.city})` : ""}${p.manufacturer ? " · mfr ✓" : ""}`);
          saveState(statePath, state);
        }
        flush();
        // A page cut short (Ctrl+C, --max-products) is redone next run; its finished products are skipped then.
        if (!finished) break outer;
        state.keywordPages[kw] = pg;
        if (!hasNext) state.keywordDone[kw] = true;
      }
    }
  } catch (e) {
    if (e instanceof CaptchaError) {
      console.log("\n⚠  Amazon showed a captcha. Progress is saved. Wait 15-30 min (or use --headful to solve it yourself), then run the same command again.");
      exitCode = 2;
    } else {
      console.error(e);
      exitCode = 1;
    }
  } finally {
    flush();
    await browser.close();
  }

  const sellers = new Set(Object.values(state.products).map((p) => p.sellerId)).size;
  const withAddress = Object.values(state.sellers).filter((s) => s.businessAddress).length;
  console.log(`\nThis run: ${newProducts} new products, ${browser.pagesLoaded} pages loaded.`);
  console.log(`Total: ${Object.keys(state.products).length} products · ${sellers} sellers (${withAddress} with a business address)`);
  console.log(`→ ${join(outDir, "leads.csv")}\n→ ${join(outDir, "products.csv")}`);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

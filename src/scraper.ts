import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CaptchaError, PoliteBrowser } from "./browser.ts";
import { writeCsv } from "./csv.ts";
import { AMAZON_SELLER, buildLeads, LEAD_HEADER, passesFilters, PRODUCT_HEADER, productLine, type Filters } from "./leads.ts";
import { isNotFound, parseProduct, parseSearch, parseSeller } from "./parse.ts";
import { loadState, saveState } from "./state.ts";

// Only for the end-to-end test against a local mock; real runs always use amazon.in.
const BASE = process.env.AMAZON_BASE_URL ?? "https://www.amazon.in";

export interface ScrapeOptions {
  keywords: string[];
  pages: number;
  /** Folder for state.json, leads.csv and products.csv of this run. */
  outDir: string;
  /** Browser profile (cookies); share it between runs so Amazon sees a returning visitor. */
  profileDir: string;
  headful: boolean;
  chrome: boolean;
  minDelaySec: number;
  maxDelaySec: number;
  maxProducts?: number;
  filters: Filters;
  includeAmazon: boolean;
  fresh?: boolean;
}

export interface Progress {
  products: number;
  sellers: number;
  sellersWithAddress: number;
  pagesLoaded: number;
  newProducts: number;
  keyword: string | null;
  page: number | null;
}

export interface ScrapeHooks {
  log?: (line: string) => void;
  progress?: (p: Progress) => void;
  /** Called when a captcha appears in a visible browser and the run is waiting for someone to solve it. */
  captcha?: (waiting: boolean) => void;
  /** Checked between pages; return true to stop cleanly. */
  shouldStop?: () => boolean;
}

export type ScrapeOutcome = "finished" | "stopped" | "captcha" | "error";

export async function runScrape(o: ScrapeOptions, h: ScrapeHooks = {}): Promise<{ outcome: ScrapeOutcome; error?: string; progress: Progress }> {
  const log = h.log ?? console.log;
  const stopped = () => h.shouldStop?.() ?? false;
  const statePath = join(o.outDir, "state.json");
  if (o.fresh && existsSync(statePath)) rmSync(statePath);
  const state = loadState(statePath);
  const maxProducts = o.maxProducts ?? Infinity;

  const browser = new PoliteBrowser({
    headful: o.headful,
    channel: o.chrome ? "chrome" : undefined,
    profileDir: o.profileDir,
    minDelayMs: o.minDelaySec * 1000,
    maxDelayMs: Math.max(o.minDelaySec, o.maxDelaySec) * 1000,
    onCaptcha: h.captcha,
    shouldStop: stopped,
  });

  let newProducts = 0;
  let keyword: string | null = null;
  let page: number | null = null;
  const progress = (): Progress => {
    const sellerIds = new Set(Object.values(state.products).map((p) => p.sellerId));
    return {
      products: Object.keys(state.products).length,
      sellers: sellerIds.size,
      sellersWithAddress: [...sellerIds].filter((id) => id && state.sellers[id]?.businessAddress).length,
      pagesLoaded: browser.pagesLoaded,
      newProducts,
      keyword,
      page,
    };
  };
  const save = () => {
    saveState(statePath, state);
    h.progress?.(progress());
  };
  const flush = () => {
    save();
    const products = Object.values(state.products);
    writeCsv(join(o.outDir, "products.csv"), PRODUCT_HEADER, products.map(productLine));
    writeCsv(join(o.outDir, "leads.csv"), LEAD_HEADER, buildLeads(products, state.sellers));
  };

  log(`Keywords: ${o.keywords.length} · pages each: ${o.pages} · already saved: ${Object.keys(state.products).length} products, ${Object.keys(state.sellers).length} sellers`);
  let outcome: ScrapeOutcome = "finished";
  let error: string | undefined;
  try {
    await browser.start();
    // Sellers missed when a previous run stopped between a product and its seller page.
    for (const p of Object.values(state.products)) {
      if (stopped()) break;
      if (p.sellerId && !state.sellers[p.sellerId]) {
        state.sellers[p.sellerId] = parseSeller(await browser.get(`${BASE}/sp?seller=${p.sellerId}`), p.sellerId);
        save();
      }
    }
    outer: for (const kw of o.keywords) {
      for (let pg = (state.keywordPages[kw] ?? 0) + 1; pg <= o.pages && !state.keywordDone[kw]; pg++) {
        if (stopped() || newProducts >= maxProducts) break outer;
        keyword = kw;
        page = pg;
        const url = `${BASE}/s?k=${encodeURIComponent(kw)}${pg > 1 ? `&page=${pg}` : ""}`;
        const { results, hasNext } = parseSearch(await browser.get(url));
        const fresh = results.filter((r) => !state.products[r.asin] && !state.skipped[r.asin]);
        log(`[${kw}] page ${pg}: ${results.length} results, ${fresh.length} new`);
        if (!results.length) log("  (no results parsed: Amazon may have changed its layout, or the keyword has no matches)");
        h.progress?.(progress());

        let finished = true;
        for (const r of fresh) {
          if (stopped() || newProducts >= maxProducts) {
            finished = false;
            break;
          }
          if (!passesFilters(r, o.filters)) {
            state.skipped[r.asin] = "filter";
            continue;
          }
          const html = await browser.get(`${BASE}/dp/${r.asin}?th=1&psc=1`);
          if (isNotFound(html)) {
            state.skipped[r.asin] = "not found";
            continue;
          }
          const p = parseProduct(html, r.asin);
          if (!p.sellerId || (!o.includeAmazon && AMAZON_SELLER.test(p.sellerName ?? ""))) {
            state.skipped[r.asin] = p.sellerId ? `amazon: ${p.sellerName}` : "no third-party seller";
            log(`  - ${r.asin} skipped (${state.skipped[r.asin]})`);
            continue;
          }
          state.products[r.asin] = { ...p, keyword: kw, searchPage: pg, position: r.position, sponsored: r.sponsored, scrapedAt: new Date().toISOString() };
          newProducts++;

          if (!state.sellers[p.sellerId]) {
            state.sellers[p.sellerId] = parseSeller(await browser.get(`${BASE}/sp?seller=${p.sellerId}`), p.sellerId);
          }
          const s = state.sellers[p.sellerId];
          log(`  + ${r.asin} ${p.brand ?? "?"} · ${s.businessName ?? p.sellerName ?? "?"}${s.city ? ` (${s.city})` : ""}${p.manufacturer ? " · mfr ✓" : ""}`);
          save();
        }
        flush();
        // A page cut short (stop, max products) is redone next run; its finished products are skipped then.
        if (!finished) break outer;
        state.keywordPages[kw] = pg;
        if (!hasNext) state.keywordDone[kw] = true;
      }
    }
    if (stopped()) outcome = "stopped";
  } catch (e) {
    if (e instanceof CaptchaError) {
      outcome = stopped() ? "stopped" : "captcha";
      if (outcome === "captcha") log("⚠  Amazon showed a captcha. Progress is saved. Wait 15-30 min (or show the browser to solve it yourself), then resume.");
    } else {
      outcome = "error";
      error = e instanceof Error ? e.message : String(e);
      log(`✗  ${error}`);
    }
  } finally {
    flush();
    await browser.close().catch(() => {});
  }
  const p = progress();
  log(`This run: ${newProducts} new products, ${browser.pagesLoaded} pages loaded.`);
  log(`Total: ${p.products} products · ${p.sellers} sellers (${p.sellersWithAddress} with a business address)`);
  return { outcome, error, progress: p };
}

/**
 * Scanning engine. Quick scan reads search / storefront pages (the one on
 * screen plus following pages, fetched). Deep scan fetches each product page
 * and each seller profile with your own amazon.in session, at a human pace,
 * caching results so repeat scans are instant. Exposes the global AxScan.
 */
(function (root) {
  "use strict";
  const P = root.AxParse;
  const CACHE_DAYS = 3;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  class CaptchaError extends Error {
    constructor() {
      super("Amazon asked for a captcha check");
      this.captcha = true;
    }
  }
  class StopError extends Error {
    constructor() {
      super("Stopped");
      this.stopped = true;
    }
  }

  // ------------------------------------------------------------ cache (chrome.storage.local)

  const hasStorage = () => typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;
  async function cacheGet(key) {
    if (!hasStorage()) return null;
    const v = (await chrome.storage.local.get(key))[key];
    return v && Date.now() - v.t < CACHE_DAYS * 864e5 ? v.d : null;
  }
  async function cacheSet(key, d) {
    if (!hasStorage()) return;
    try {
      await chrome.storage.local.set({ [key]: { t: Date.now(), d } });
    } catch (e) {
      // Storage full: drop the cache and carry on without it.
      await chrome.storage.local.clear();
    }
  }
  async function clearCache() {
    if (hasStorage()) await chrome.storage.local.clear();
  }

  // ------------------------------------------------------------ paced fetching

  function makeFetcher(opts) {
    let last = 0;
    return async function fetchDoc(url) {
      const gap = (opts.minDelay + Math.random() * Math.max(0, opts.maxDelay - opts.minDelay)) * 1000;
      while (last && Date.now() - last < gap) {
        if (opts.shouldStop()) throw new StopError();
        await sleep(Math.min(250, gap - (Date.now() - last)));
      }
      if (opts.shouldStop()) throw new StopError();
      last = Date.now();
      const res = await fetch(url, { credentials: "include" });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      if (res.status === 503 || P.isCaptcha(doc)) throw new CaptchaError();
      opts.onFetch && opts.onFetch();
      return doc;
    };
  }

  function pageUrl(base, page) {
    const u = new URL(base);
    if (page <= 1) u.searchParams.delete("page");
    else u.searchParams.set("page", String(page));
    u.searchParams.delete("ref");
    return u.toString();
  }

  /** Overall organic / sponsored rank across all scanned pages, in page order. */
  function rankAcrossPages(rows) {
    let o = 0;
    let s = 0;
    for (const r of rows) {
      if (r.type === "Organic") r.organicRankOverall = ++o;
      else r.sponsoredRankOverall = ++s;
    }
    return rows;
  }

  /**
   * Quick scan: the current page from the live DOM, then `pages - 1` more pages fetched.
   * onRows(rows) is called after each page so the table fills as it goes.
   */
  async function quickScan({ doc, location, pages, opts, onRows }) {
    const fetchDoc = makeFetcher(opts);
    const first = P.parseSearch(doc, Number(new URL(location.href).searchParams.get("page")) || 1);
    let rows = first.rows;
    onRows(rankAcrossPages(rows), { page: first.page, of: first.page + pages - 1 });
    let hasNext = first.hasNext;
    for (let i = 1; i < pages && hasNext; i++) {
      const pg = first.page + i;
      const d = await fetchDoc(pageUrl(location.href, pg));
      const res = P.parseSearch(d, pg);
      rows = rows.concat(res.rows);
      hasNext = res.hasNext;
      onRows(rankAcrossPages(rows), { page: pg, of: first.page + pages - 1 });
    }
    return rows;
  }

  /**
   * Deep scan: adds product-page and seller-profile fields to each row (unique
   * ASINs only). onUpdate(row, done, total) after each one.
   */
  async function deepScan({ rows, opts, onUpdate }) {
    const fetchDoc = makeFetcher(opts);
    const asins = [...new Set(rows.map((r) => r.asin))];
    let done = 0;
    for (const asin of asins) {
      if (opts.shouldStop()) throw new StopError();
      let product = await cacheGet("p:" + asin);
      if (!product) {
        const d = await fetchDoc(`${location.origin}/dp/${asin}?th=1&psc=1`);
        product = P.isNotFound(d) ? { asin, notFound: true } : P.parseProduct(d, asin);
        await cacheSet("p:" + asin, product);
      }
      let seller = null;
      if (opts.sellerPages && product.sellerId && !/^amazon/i.test(product.buyboxSeller || "")) {
        seller = await cacheGet("s:" + product.sellerId);
        if (!seller) {
          seller = P.parseSeller(await fetchDoc(`${location.origin}/sp?seller=${product.sellerId}`), product.sellerId);
          await cacheSet("s:" + product.sellerId, seller);
        }
      }
      done++;
      for (const r of rows) {
        if (r.asin !== asin) continue;
        // Search-card values win where present (they're what the shopper sees on that page).
        for (const [k, v] of Object.entries(product)) if (r[k] == null || r[k] === "") r[k] = v;
        if (seller) Object.assign(r, seller);
        r.deep = true;
        onUpdate(r, done, asins.length);
      }
    }
    return rows;
  }

  /** Single product page: live DOM, plus its seller profile when asked. */
  async function productScan({ doc, asin, opts }) {
    const row = { page: null, position: null, type: "Product page", ...P.parseProduct(doc, asin), deep: true };
    if (opts.sellerPages && row.sellerId && !/^amazon/i.test(row.buyboxSeller || "")) {
      let seller = await cacheGet("s:" + row.sellerId);
      if (!seller) {
        seller = P.parseSeller(await makeFetcher(opts)(`${location.origin}/sp?seller=${row.sellerId}`), row.sellerId);
        await cacheSet("s:" + row.sellerId, seller);
      }
      Object.assign(row, seller);
    }
    return [row];
  }

  root.AxScan = { quickScan, deepScan, productScan, clearCache, pageUrl, rankAcrossPages, makeFetcher, CaptchaError, StopError };
})(typeof window !== "undefined" ? window : globalThis);

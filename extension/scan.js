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
  // After Xray is updated or reloaded, a tab opened before that keeps the old copy, whose chrome.storage
  // calls throw "Extension context invalidated". The cache is only a speed-up, so scans carry on without it.
  async function cacheGet(key) {
    if (!hasStorage()) return null;
    try {
      const v = (await chrome.storage.local.get(key))[key];
      return v && Date.now() - v.t < CACHE_DAYS * 864e5 ? v.d : null;
    } catch (e) {
      return null;
    }
  }
  async function cacheSet(key, d) {
    if (!hasStorage()) return;
    try {
      await chrome.storage.local.set({ [key]: { t: Date.now(), d } });
    } catch (e) {
      // Storage full: drop the cache and carry on without it.
      try {
        await chrome.storage.local.clear();
      } catch (e2) {}
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
      if (res.status === 503 || (opts.site || P).isCaptcha(doc)) throw new CaptchaError();
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
    const site = opts.site || P;
    const fetchDoc = makeFetcher(opts);
    const toUrl = site.pageUrl || pageUrl;
    // A site whose page on screen may be stale (Flipkart is a single-page app) is read fresh.
    const firstDoc = site.liveDocTrusted === false ? await fetchDoc(location.href) : doc;
    const first = site.parseSearch(firstDoc, Number(new URL(location.href).searchParams.get("page")) || 1);
    let rows = first.rows;
    onRows(rankAcrossPages(rows), { page: first.page, of: first.page + pages - 1 });
    let hasNext = first.hasNext;
    for (let i = 1; i < pages && hasNext; i++) {
      const pg = first.page + i;
      const d = await fetchDoc(toUrl(location.href, pg));
      const res = site.parseSearch(d, pg);
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
    const site = opts.site || P;
    const amazon = site === P;
    const fetchDoc = makeFetcher(opts);
    const asins = [...new Set(rows.map((r) => r.asin))];
    let done = 0;
    for (const asin of asins) {
      if (opts.shouldStop()) throw new StopError();
      // "p2:" since 1.3.2: earlier saved results could say FBA for Easy Ship listings.
      const key = (site.cachePrefix || "p2:") + asin;
      let product = await cacheGet(key);
      if (!product) {
        const d = await fetchDoc(amazon ? `${location.origin}/dp/${asin}?th=1&psc=1` : site.productUrl(rows.find((r) => r.asin === asin)));
        product = site.isNotFound(d) ? { asin, notFound: true } : site.parseProduct(d, asin);
        await cacheSet(key, product);
      }
      let seller = null;
      // Flipkart's product page already carries the seller details; only Amazon has a separate profile page.
      if (amazon && opts.sellerPages && product.sellerId && !/^amazon/i.test(product.buyboxSeller || "")) {
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
    const site = opts.site || P;
    if (site !== P) {
      const d = site.liveDocTrusted === false ? await makeFetcher(opts)(location.href) : doc;
      const title = String(d.title || "").replace(/\s*[-|:]\s*(Price in India|Buy).*$/i, "").replace(/\s*\|\s*Flipkart\.com$/i, "").trim() || null;
      return [{ page: null, position: null, type: "Product page", title, url: location.href, ...site.parseProduct(d, asin), deep: true }];
    }
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

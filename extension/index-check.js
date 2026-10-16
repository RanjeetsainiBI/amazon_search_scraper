/**
 * Index Checker logic. For every keyword × ASIN pair:
 *  1. Indexed? Search "<keyword> <ASIN>". If that ASIN comes back as a result,
 *     Amazon has it indexed for the keyword.
 *  2. Rank: for keywords where at least one ASIN is indexed, search the plain
 *     keyword (pages 1..N) and record each ASIN's organic and sponsored position.
 * Classic script: exposes AxIndex. Needs AxParse (parse.js) and AxScan (scan.js).
 */
(function (root) {
  "use strict";
  const P = root.AxParse;
  const BASE = "https://www.amazon.in";

  const ASIN_RE = /\b(B0[A-Z0-9]{8}|\d{9}[\dX])\b/;

  /** ASINs from free text or pasted product URLs, upper-cased and de-duplicated. */
  function parseAsins(text) {
    const out = [];
    for (const part of String(text || "").toUpperCase().split(/[\s,;|]+/)) {
      const m = part.match(/\/(?:DP|GP\/PRODUCT)\/([A-Z0-9]{10})/) || part.match(ASIN_RE);
      if (m && !out.includes(m[1])) out.push(m[1]);
    }
    return out;
  }

  /** Keywords one per line (commas also split), trimmed, lower-cased, de-duplicated. */
  function parseKeywords(text) {
    const seen = new Set();
    const out = [];
    for (const raw of String(text || "").split(/[\n,]+/)) {
      const k = raw.replace(/\s+/g, " ").trim().toLowerCase();
      if (k && k.length <= 120 && !seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
    return out;
  }

  const STOP = new Set(
    ("a an and the for with of to in on by from at as or is are be it this that your you our its into up out per "
      + "pack set pcs piece pieces combo new best premium quality high size color colour free made design "
      + "cm mm ml l kg g gm inch inches x 1 2 3 4 5 6 7 8 9 10 & - + | / ( ) , .").split(/\s+/),
  );

  /**
   * Keyword ideas from a product page: the brand plus 1- to 3-word phrases from
   * the title and bullets, scored by where they appear (title counts most) and
   * how often. Phrases that start or end with a filler word are dropped.
   */
  function suggestKeywords(product, max) {
    const limit = max || 40;
    const score = new Map();
    const add = (text, weight) => {
      const words = String(text || "")
        .toLowerCase()
        .replace(/[^a-z0-9ऀ-ॿ\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w && !/^\d+$/.test(w));
      for (let n = 1; n <= 3; n++) {
        for (let i = 0; i + n <= words.length; i++) {
          const gram = words.slice(i, i + n);
          if (STOP.has(gram[0]) || STOP.has(gram[gram.length - 1]) || gram.some((w) => w.length < 2)) continue;
          // A filler word in the middle reads oddly ("strap with carry"), except "for" ("mat for women").
          if (n === 3 && STOP.has(gram[1]) && gram[1] !== "for") continue;
          const phrase = gram.join(" ");
          // Longer phrases are what shoppers type; single words are usually too broad.
          score.set(phrase, (score.get(phrase) || 0) + weight * (n === 1 ? 0.6 : n === 2 ? 1.2 : 1.4));
        }
      }
    };
    const brand = (product.brand || "").toLowerCase();
    let title = product.title || "";
    if (brand) title = title.replace(new RegExp("^" + brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*", "i"), "");
    add(title, 3);
    (product.bullets || []).forEach((b) => add(String(b).slice(0, 160), 1));
    const ranked = [...score.entries()]
      .filter(([p]) => !brand || !p.split(" ").every((w) => brand.split(/\s+/).includes(w)))
      .sort((a, b) => b[1] - a[1])
      .map(([p]) => p);
    const out = brand ? [brand] : [];
    for (const p of ranked) {
      // Skip a phrase that's already covered by a longer chosen one ("yoga mat" when "yoga mat 6mm" is in).
      if (out.length >= limit) break;
      if (out.some((o) => o.includes(p) && o.split(" ").length - p.split(" ").length <= 1 && p.split(" ").length > 1)) continue;
      out.push(p);
    }
    return out.slice(0, limit);
  }

  /** Title, brand and bullets of a product page (live or fetched). */
  function listingText(doc, asin) {
    const p = P.parseProduct(doc, asin);
    const bullets = Array.from(doc.querySelectorAll("#feature-bullets li span.a-list-item")).map((e) => P.clean(e.textContent)).filter(Boolean);
    return { asin, title: p.title, brand: p.brand, bullets };
  }

  const searchUrl = (q, page) => `${BASE}/s?k=${encodeURIComponent(q)}${page > 1 ? `&page=${page}` : ""}`;

  /** True when `asin` is one of the results of the "<keyword> <ASIN>" search. */
  function indexedIn(doc, asin) {
    return P.parseSearch(doc, 1).rows.some((r) => r.asin === asin);
  }

  /**
   * Organic and sponsored positions of each ASIN across already-parsed result
   * pages (in page order). First appearance wins.
   */
  function ranksFrom(rowsByPage, asins) {
    const out = {};
    let organic = 0;
    let sponsored = 0;
    for (const { page, rows } of rowsByPage) {
      for (const r of rows) {
        if (r.type === "Organic") organic++;
        else sponsored++;
        if (!asins.includes(r.asin)) continue;
        const o = (out[r.asin] = out[r.asin] || { organicRank: null, organicPage: null, sponsoredRank: null, sponsoredPage: null });
        if (r.type === "Organic" && o.organicRank == null) {
          o.organicRank = organic;
          o.organicPage = page;
        } else if (r.type === "Sponsored" && o.sponsoredRank == null) {
          o.sponsoredRank = sponsored;
          o.sponsoredPage = page;
        }
      }
    }
    return out;
  }

  /**
   * Runs the whole check. fetchDoc is a paced fetcher (AxScan.makeFetcher).
   * onResult(keyword, asin, result) fires as each cell is known; onProgress(done, total, label).
   * Results: { indexed: true|false|null, organicRank, organicPage, sponsoredRank, sponsoredPage, error }.
   */
  async function run({ keywords, asins, pages, fetchDoc, onResult, onProgress, shouldStop, prior }) {
    // `prior` = results of an interrupted run with the same inputs: finished cells are skipped.
    const results = prior || {};
    const set = (k, a, patch) => {
      results[k] = results[k] || {};
      results[k][a] = Object.assign(results[k][a] || {}, patch);
      onResult && onResult(k, a, results[k][a]);
    };
    const indexTotal = keywords.length * asins.length;
    let done = 0;
    let total = indexTotal;
    const step = (label) => onProgress && onProgress(++done, total, label);

    // Phase 1: indexed or not.
    for (const k of keywords) {
      for (const a of asins) {
        if (results[k] && results[k][a] && typeof results[k][a].indexed === "boolean") {
          step(`Indexed? “${k}” · ${a} (saved)`);
          continue;
        }
        if (shouldStop && shouldStop()) throw new root.AxScan.StopError();
        const doc = await fetchDoc(searchUrl(`${k} ${a}`, 1));
        set(k, a, { indexed: indexedIn(doc, a) });
        step(`Indexed? “${k}” · ${a}`);
      }
    }

    // Phase 2: positions for keywords with at least one indexed ASIN.
    const rankKeywords = pages > 0 ? keywords.filter((k) => asins.some((a) => results[k][a].indexed)) : [];
    total = indexTotal + rankKeywords.length * pages;
    for (const k of rankKeywords) {
      if (pages < 1 || asins.every((a) => results[k][a].ranked)) {
        done += Math.max(0, pages);
        continue;
      }
      const byPage = [];
      for (let pg = 1; pg <= pages; pg++) {
        if (shouldStop && shouldStop()) throw new root.AxScan.StopError();
        const res = P.parseSearch(await fetchDoc(searchUrl(k, pg)), pg);
        byPage.push({ page: pg, rows: res.rows });
        // Results ran out: count the pages we don't need so the progress bar still ends at 100%.
        if (!res.hasNext) done += pages - pg;
        step(`Rank: “${k}” page ${pg}`);
        if (!res.hasNext) break;
      }
      const ranks = ranksFrom(byPage, asins);
      for (const a of asins) {
        const r = ranks[a] || { organicRank: null, organicPage: null, sponsoredRank: null, sponsoredPage: null };
        // Showing up organically for the plain keyword proves it's indexed, whatever the ASIN search said.
        set(k, a, { ranked: true, ...r, ...(r.organicRank && !results[k][a].indexed ? { indexed: true, indexedByRank: true } : {}) });
      }
    }
    return results;
  }

  /** Requests a run will make, for the time estimate (worst case: every keyword indexed). */
  const estimateRequests = (k, a, pages) => k * a + k * pages;

  root.AxIndex = { parseAsins, parseKeywords, suggestKeywords, listingText, searchUrl, indexedIn, ranksFrom, run, estimateRequests };
})(typeof window !== "undefined" ? window : globalThis);

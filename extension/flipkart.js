/**
 * Flipkart parsers for Xray (search results and product pages). Flipkart's CSS
 * class names are generated and change often, so everything is read from the
 * JSON the page ships in `window.__INITIAL_STATE__` (search: product list with
 * an adInfo block on sponsored cards; product page: seller, specs and
 * manufacturer details). Classic script: exposes AxFk, the same shape of site
 * object as AxParse so the scanner and panel can use either.
 */
(function (root) {
  "use strict";

  const clean = (s) =>
    String(s ?? "")
      .replace(/&amp;/g, "&")
      .replace(/[‎‏‪-‮ ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const num = (s) => {
    const m = String(s ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  };

  // ---------------------------------------------------------------- page state

  /** The object assigned to window.__INITIAL_STATE__ in one of the page's inline scripts, or null. */
  function pageState(doc) {
    const script = Array.from(doc.querySelectorAll("script")).find((s) => s.textContent.includes("window.__INITIAL_STATE__"));
    if (!script) return null;
    const t = script.textContent;
    const start = t.indexOf("{", t.indexOf("window.__INITIAL_STATE__"));
    if (start < 0) return null;
    // The script can hold more statements after the object: cut at the matching brace.
    let depth = 0;
    let inStr = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          return JSON.parse(t.slice(start, i + 1));
        } catch (e) {
          return null;
        }
      }
    }
    return null;
  }

  /** Every object inside `o` (depth first, document order) for which `test` is true. */
  function findAll(o, test, out = []) {
    if (Array.isArray(o)) for (const v of o) findAll(v, test, out);
    else if (o && typeof o === "object") {
      if (test(o)) out.push(o);
      for (const k of Object.keys(o)) findAll(o[k], test, out);
    }
    return out;
  }
  const textOf = (o) => {
    const v = o && o.value && o.value.text;
    return Array.isArray(v) ? clean(v.join(", ")) : v != null ? clean(v) : null;
  };

  // ---------------------------------------------------------------- pages

  const isHere = (loc) => /(^|\.)flipkart\.com$/.test(new URL(loc.href).hostname);

  function pageKind(loc) {
    const u = new URL(loc.href);
    if (/\/p\/itm/.test(u.pathname) && u.searchParams.get("pid")) return "product";
    if (u.pathname === "/search" && u.searchParams.get("q")) return "search";
    return "other";
  }

  const idFromUrl = (href) => {
    try {
      return new URL(href, "https://www.flipkart.com").searchParams.get("pid");
    } catch (e) {
      return null;
    }
  };

  /** Flipkart's "Are you a human?" check or an error page instead of results. */
  function isCaptcha(doc) {
    return /are you a human|captcha|access denied/i.test(doc.title || "") || (!pageState(doc) && /recaptcha|verify you are human/i.test(doc.body ? doc.body.textContent.slice(0, 3000) : ""));
  }
  const isNotFound = (doc) => /page not found|404/i.test(doc.title || "");

  // ---------------------------------------------------------------- search results

  const imageUrl = (media) => {
    const u = media && media.images && media.images[0] && media.images[0].url;
    return u ? u.replace("{@width}", "200").replace("{@height}", "200").replace("{@quality}", "70").replace(/^http:/, "https:") : null;
  };

  function priceOf(pricing) {
    const prices = (pricing && pricing.prices) || [];
    const sell = prices.find((p) => !p.strikeOff && /SPECIAL_PRICE|FSP|SELLING/i.test(p.priceType || p.name || "")) || prices.find((p) => !p.strikeOff);
    const mrp = prices.find((p) => p.strikeOff);
    return { price: sell ? sell.value : null, mrp: mrp ? mrp.value : null, discountPct: pricing && pricing.totalDiscount != null ? pricing.totalDiscount : null };
  }

  /** One search-result row from a product entry in the page JSON. */
  function rowFromProduct(entry, position, page) {
    const v = entry.productInfo.value;
    const t = v.titles || {};
    const rating = v.rating || {};
    const tags = (v.productCardTagDetails || []).map((x) => x && x.type).filter(Boolean);
    const sp = !!entry.adInfo;
    return {
      page,
      position,
      type: sp ? "Sponsored" : "Organic",
      asin: v.id, // Flipkart product ID (FSN); kept in the "asin" field so the scanner treats both sites alike
      listingId: v.listingId || null,
      url: v.baseUrl ? "https://www.flipkart.com" + v.baseUrl.replace(/&amp;/g, "&") : null,
      title: clean(t.title || [t.superTitle, t.newTitle].filter(Boolean).join(" ")) || null,
      brand: clean(t.superTitle) || null,
      variant: clean(t.subtitle) || null,
      ...priceOf(v.pricing),
      rating: rating.average != null ? Number(rating.average) : null,
      ratingsCount: rating.count != null ? Number(rating.count) : null,
      reviews: rating.reviewCount != null ? Number(rating.reviewCount) : null,
      fAssured: tags.includes("F_ASSURED"),
      availability: (v.availability && v.availability.displayState) || null,
      category: (v.analyticsData && [v.analyticsData.category, v.analyticsData.vertical].filter(Boolean).join(" › ")) || null,
      image: imageUrl(v.media),
    };
  }

  /** Fallback when the page JSON is missing: product cards in the DOM (sponsored label is an SVG image). */
  function rowsFromDom(doc, page) {
    return Array.from(doc.querySelectorAll("div[data-id]"))
      .filter((c) => /^[A-Z0-9]{16}$/.test(c.getAttribute("data-id")))
      .map((card, i) => {
        const link = card.querySelector("a[href*='pid=']");
        const titled = card.querySelector("a[title]");
        return {
          page,
          position: i + 1,
          type: card.querySelector("svg[width='62'][height='18']") ? "Sponsored" : "Organic",
          asin: card.getAttribute("data-id"),
          url: link ? new URL(link.getAttribute("href"), "https://www.flipkart.com").toString() : null,
          title: titled ? clean(titled.getAttribute("title")) : null,
          image: card.querySelector("img") ? card.querySelector("img").getAttribute("src") : null,
        };
      });
  }

  /** Listings in page order with organic / sponsored rank on this page. */
  function parseSearch(doc, page) {
    const state = pageState(doc);
    const products = state ? findAll(state.pageDataV4 || state, (o) => o.productInfo && o.productInfo.value && o.productInfo.value.id) : [];
    const paging = state ? findAll(state.pageDataV4 || state, (o) => typeof o.totalPages === "number")[0] : null;
    const current = (paging && paging.currentPage) || page || 1;
    let rows = products.length ? products.map((p, i) => rowFromProduct(p, i + 1, current)) : rowsFromDom(doc, current);
    const seen = new Set();
    let organic = 0;
    let sponsored = 0;
    rows = rows.map((r) => {
      const dup = seen.has(r.asin);
      seen.add(r.asin);
      return { ...r, duplicate: dup, organicRank: r.type === "Organic" ? ++organic : null, sponsoredRank: r.type === "Sponsored" ? ++sponsored : null };
    });
    const hasNext = paging ? current < paging.totalPages : !!Array.from(doc.querySelectorAll("a")).find((a) => /^next$/i.test(clean(a.textContent)));
    return { rows, hasNext, page: current, totalPages: paging ? paging.totalPages : null };
  }

  function pageUrl(base, page) {
    const u = new URL(base);
    if (page <= 1) u.searchParams.delete("page");
    else u.searchParams.set("page", String(page));
    return u.toString();
  }

  // ---------------------------------------------------------------- product page

  /** Label → value pairs from the page's spec and manufacturer-info widgets ("Model Name" → "Stash Bifold Wallet"). */
  function specPairs(state) {
    const out = {};
    for (const o of findAll(state, (x) => x.label_0 && x.label_1 && typeof (x.label_0.value && x.label_0.value.text) === "string")) {
      const k = textOf(o.label_0);
      const v = textOf(o.label_1);
      if (k && v && k.length < 60 && !(k in out) && !/^[\d.%₹•]+$/.test(k)) out[k] = v;
    }
    return out;
  }
  const pick = (d, ...res) => {
    for (const r of res) {
      const k = Object.keys(d).find((key) => r.test(key));
      if (k) return d[k];
    }
    return null;
  };

  /** Seller name, rating, tenure and scores from the "seller details" sheet. */
  function sellerOf(state) {
    const sheet = findAll(state, (o) => o.widgetName === "ATLAS_SELLER_DETAILS" && o.data)[0];
    const out = { sellerName: null, sellerRating: null, sellerTenure: null, sellerProductsSold: null, sellerQualityScore: null, sellerSpeedScore: null, sellerAbout: null, fssai: null };
    if (!sheet) return out;
    const d = sheet.data.dlsData || sheet.data;
    const title = Object.keys(d).find((k) => /seller_details_seller_title/.test(k));
    if (title) {
      const t = d[title].value || {};
      out.sellerName = textOf(t.label_0);
      for (const k of Object.keys(t)) {
        const v = textOf(t[k]);
        if (!v) continue;
        if (/with Flipkart/i.test(v)) out.sellerTenure = v;
        else if (/^\d(\.\d)?$/.test(v) && out.sellerRating == null) out.sellerRating = Number(v);
      }
      for (const score of findAll(t, (o) => o.label_0 && o.label_1)) {
        const label = textOf(score.label_1) || "";
        const value = textOf(score.label_0);
        if (/product(s)? sold/i.test(label)) out.sellerProductsSold = value;
        else if (/quality score/i.test(label)) out.sellerQualityScore = value;
        else if (/speed score/i.test(label)) out.sellerSpeedScore = value;
      }
    }
    const about = Object.keys(d).find((k) => /about_seller/.test(k));
    if (about) out.sellerAbout = textOf((d[about].value || {}).label_0);
    if (d.label_2 && /fssai/i.test(textOf(d.label_2) || "")) out.fssai = textOf(d.label_1);
    return out;
  }

  /** Seller, fulfilment, F-Assured, stock, specs and manufacturer details from a product page. */
  function parseProduct(doc, id) {
    const state = pageState(doc);
    if (!state) return { asin: id, notFound: isNotFound(doc) };
    const pls = findAll(state, (o) => o.pls && typeof o.pls === "object" && "sellerId" in o.pls)[0];
    const listing = pls ? pls.pls : {};
    const specs = specPairs(state);
    const seller = sellerOf(state);
    // The product page has no single rating field, only the star breakdown: [{ratingValue: 5, ratingCount: 10}, …].
    const breakup = findAll(state, (o) => Array.isArray(o.individualRatingsCount) && o.individualRatingsCount.length)[0];
    let rating = null;
    if (breakup) {
      const b = breakup.individualRatingsCount;
      const count = b.reduce((a, x) => a + (Number(x.ratingCount) || 0), 0);
      rating = count ? { average: Math.round((b.reduce((a, x) => a + x.ratingValue * (Number(x.ratingCount) || 0), 0) / count) * 10) / 10, count } : null;
    }
    const highlights = findAll(state, (o) => Array.isArray(o.highlights) && o.highlights.length)[0];
    return {
      asin: id,
      sellerId: listing.sellerId || null,
      buyboxSeller: seller.sellerName,
      ...seller,
      fulfillment: listing.fbf === true ? "Flipkart (FBF)" : listing.fbf === false ? "Seller" : null,
      fAssured: listing.fa === true ? true : listing.fa === false ? false : null,
      availability: listing.availabilityStatus || null,
      rating: rating ? Number(rating.average) : null,
      ratingsCount: rating ? Number(rating.count) : null,
      manufacturer: pick(specs, /address of the manufacturer/i, /^manufacturer/i, /manufactured by/i),
      packer: pick(specs, /address of the packer/i, /^packer/i, /packed by/i),
      importer: pick(specs, /address of the importer/i, /^importer/i, /imported by/i),
      countryOfOrigin: pick(specs, /^country of origin$/i),
      modelName: pick(specs, /^model name$/i, /^model number$/i, /^model$/i),
      genericName: pick(specs, /generic name/i),
      netQuantity: pick(specs, /^net quantity$/i, /^quantity$/i),
      highlights: highlights ? highlights.highlights.map(clean).filter(Boolean).join(" | ") : null,
      specCount: Object.keys(specs).length,
    };
  }

  const productUrl = (row) => row.url || `https://www.flipkart.com/product/p/itm?pid=${encodeURIComponent(row.asin)}`;
  const sellersUrl = (row) => `https://www.flipkart.com/sellers?pid=${encodeURIComponent(row.asin)}`;

  root.AxFk = {
    site: "flipkart",
    name: "Flipkart",
    idLabel: "FSN",
    cachePrefix: "fk1:",
    // Flipkart is a single-page app: after in-page navigation the live DOM can hold an older page's JSON,
    // so the scanner fetches the current URL instead of reading the document on screen.
    liveDocTrusted: false,
    isHere,
    pageKind,
    idFromUrl,
    isCaptcha,
    isNotFound,
    pageState,
    parseSearch,
    parseProduct,
    pageUrl,
    productUrl,
    sellersUrl,
    num,
  };
})(typeof window !== "undefined" ? window : globalThis);

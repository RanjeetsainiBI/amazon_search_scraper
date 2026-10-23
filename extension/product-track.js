/**
 * Product Track logic: for each ASIN, open its product page and record who holds
 * the Buy Box, at what price, and whether that's one of "your" sellers; compare
 * with the previous check to flag changes. Classic script: exposes AxTrack.
 * Needs AxParse (parse.js) and AxScan (scan.js).
 */
(function (root) {
  "use strict";
  const P = root.AxParse;

  /**
   * One snapshot from a product page.
   * status: "buybox" (someone holds it) | "no_buybox" (in stock offers but nobody has the Buy Box)
   *       | "unavailable" (no offers) | "not_found" (page gone: removed or suppressed)
   */
  function snapshot(doc, asin) {
    if (P.isNotFound(doc)) return { asin, status: "not_found" };
    const p = P.parseProduct(doc, asin);
    const unavailable = /currently unavailable|out of stock|unavailable/i.test(p.availability || "");
    let status;
    if (p.buyboxWon && p.buyboxSeller) status = "buybox";
    else if (unavailable && !p.otherOffers) status = "unavailable";
    else status = "no_buybox";
    return {
      asin,
      status,
      title: p.title,
      brand: p.brand,
      buyboxSeller: status === "buybox" ? p.buyboxSeller : null,
      sellerId: status === "buybox" ? p.sellerId : null,
      fulfillment: status === "buybox" ? p.fulfillment : null,
      price: status === "buybox" ? p.price : null,
      mrp: p.mrp,
      availability: p.availability,
      otherOffers: p.otherOffers,
      rating: p.rating,
      reviews: p.reviews,
      bsr: p.bsr,
      bsrCategory: p.bsrCategory,
      subRanks: p.subRanks,
      discountPct: status === "buybox" ? p.discountPct : null,
      shipsFrom: status === "buybox" ? p.shipsFrom : null,
      coupon: p.coupon,
      couponPercent: p.couponPercent,
      couponAmount: p.couponAmount,
      deal: p.deal,
      badges: p.badges,
      boughtPastMonth: p.boughtPastMonth,
      delivery: p.delivery,
      deliveryCharge: p.deliveryCharge,
      fastestDelivery: p.fastestDelivery,
      deliverTo: p.deliverTo,
      listingDate: p.listingDate,
      dateFirstAvailable: p.dateFirstAvailable,
      listingAgeDays: p.listingAgeDays,
      manufacturer: p.manufacturer,
      packer: p.packer,
      importer: p.importer,
      countryOfOrigin: p.countryOfOrigin,
      modelNumber: p.modelNumber,
      partNumber: p.partNumber,
      genericName: p.genericName,
      netQuantity: p.netQuantity,
      itemWeight: p.itemWeight,
      dimensions: p.dimensions,
      department: p.department,
      imageCount: p.imageCount,
      hasAplus: p.hasAplus,
      hasVideo: p.hasVideo,
      bulletCount: p.bulletCount,
      bullets: p.bullets,
    };
  }

  /** Seller-profile fields copied onto a snapshot (from /sp?seller=…). */
  function withSeller(snap, seller) {
    if (!seller) return snap;
    return {
      ...snap,
      // The profile's store name is the reliable one when the product page only had a generic link.
      buyboxSeller: snap.buyboxSeller || seller.storeName || null,
      sellerStoreName: seller.storeName,
      businessName: seller.businessName,
      businessAddress: seller.businessAddress,
      sellerCity: seller.city,
      sellerState: seller.state,
      sellerPincode: seller.pincode,
      sellerRating: seller.sellerRating,
      sellerRatingsCount: seller.sellerRatingsCount,
    };
  }

  /** "Your sellers" input: names or seller IDs, one per line or comma-separated. */
  function parseOwn(text) {
    return String(text || "")
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

  /** "you" | "other" | "none" (nobody has it) | null (no own sellers set). */
  function owner(snap, own) {
    if (!own || !own.length) return null;
    if (snap.status !== "buybox") return "none";
    const id = (snap.sellerId || "").toUpperCase();
    const name = norm(snap.buyboxSeller);
    const mine = own.some((o) => (/^A[A-Z0-9]{9,19}$/i.test(o) ? o.toUpperCase() === id : name && norm(o) === name));
    return mine ? "you" : "other";
  }

  /** Human-readable differences from the previous snapshot of the same ASIN. */
  function changes(prev, cur) {
    if (!prev) return [];
    const out = [];
    if (prev.status !== cur.status) out.push({ kind: "status", text: `${label(prev.status)} → ${label(cur.status)}` });
    else if (cur.status === "buybox" && (prev.sellerId || prev.buyboxSeller) !== (cur.sellerId || cur.buyboxSeller)) {
      out.push({ kind: "seller", text: `Buy Box: ${prev.buyboxSeller || "?"} → ${cur.buyboxSeller || "?"}` });
    }
    if (prev.price != null && cur.price != null && prev.price !== cur.price) {
      const pct = Math.round(((cur.price - prev.price) / prev.price) * 100);
      out.push({ kind: "price", text: `Price ₹${prev.price} → ₹${cur.price} (${pct > 0 ? "+" : ""}${pct}%)` });
    }
    if ((prev.coupon || null) !== (cur.coupon || null) && (prev.coupon !== undefined)) {
      out.push({ kind: "promo", text: !cur.coupon ? `Coupon ${prev.coupon} ended` : !prev.coupon ? `Coupon ${cur.coupon} started` : `Coupon ${prev.coupon} → ${cur.coupon}` });
    }
    if ((prev.deal || null) !== (cur.deal || null) && (prev.deal !== undefined)) {
      out.push({ kind: "promo", text: !cur.deal ? `Deal ended (${prev.deal})` : !prev.deal ? `Deal started: ${cur.deal}` : `Deal: ${prev.deal} → ${cur.deal}` });
    }
    if (prev.otherOffers != null && cur.otherOffers != null && cur.otherOffers > prev.otherOffers) {
      out.push({ kind: "offers", text: `Offers ${prev.otherOffers} → ${cur.otherOffers}` });
    }
    return out;
  }

  const LABELS = { buybox: "Has Buy Box", no_buybox: "No Buy Box", unavailable: "Unavailable", not_found: "Not found" };
  const label = (s) => LABELS[s] || s;

  /**
   * Checks every ASIN (skipping ones already in `results` from an interrupted
   * run). With `sellerInfo`, each Buy Box seller's profile page is opened once
   * (cached in `sellers` by seller ID) for business name, address and rating.
   * onRow(asin, snap) after each; onProgress(done, total).
   */
  async function run({ asins, fetchDoc, results, sellers, sellerInfo, onRow, onProgress, shouldStop }) {
    const out = results || {};
    const cache = sellers || {};
    let done = 0;
    for (const asin of asins) {
      if (out[asin]) {
        onProgress && onProgress(++done, asins.length);
        continue;
      }
      if (shouldStop && shouldStop()) throw new root.AxScan.StopError();
      const doc = await fetchDoc(`https://www.amazon.in/dp/${asin}?th=1&psc=1`);
      let snap = snapshot(doc, asin);
      if (sellerInfo && snap.sellerId) {
        if (!cache[snap.sellerId]) {
          if (shouldStop && shouldStop()) throw new root.AxScan.StopError();
          cache[snap.sellerId] = P.parseSeller(await fetchDoc(`https://www.amazon.in/sp?seller=${snap.sellerId}`), snap.sellerId);
        }
        snap = withSeller(snap, cache[snap.sellerId]);
      }
      out[asin] = { ...snap, checkedAt: new Date().toISOString() };
      if (onRow) await onRow(asin, out[asin]);
      onProgress && onProgress(++done, asins.length);
    }
    return out;
  }

  root.AxTrack = { snapshot, withSeller, parseOwn, owner, changes, label, run };
})(typeof window !== "undefined" ? window : globalThis);

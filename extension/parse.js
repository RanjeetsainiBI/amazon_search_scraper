/**
 * DOM parsers for amazon.in pages. They take a Document: the live page for a
 * quick scan, or HTML fetched and run through DOMParser for a deep scan.
 * Classic script (no modules) so it can be listed in manifest content_scripts;
 * it exposes one global, AxParse. Tests load it in jsdom.
 */
(function (root) {
  "use strict";

  const clean = (s) =>
    String(s ?? "")
      .replace(/[‎‏‪-‮ ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const num = (s) => {
    const m = String(s ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : null;
  };

  /** "1.2K" / "12,345" / "(3,210)" / "5K+" -> number */
  const count = (s) => {
    const t = clean(s).replace(/[(),+]/g, "");
    const m = t.match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
    if (!m) return null;
    const mult = m[2] ? (/k/i.test(m[2]) ? 1e3 : 1e6) : 1;
    return Math.round(Number(m[1]) * mult);
  };

  const text = (el) => (el ? clean(el.textContent) : "");
  const q = (el, sel) => el.querySelector(sel);
  const t = (el, sel) => text(q(el, sel)) || null;

  function isCaptcha(doc) {
    return !!q(doc, 'form[action*="validateCaptcha"]') || /robot check/i.test(doc.title || "") || /Type the characters you see in this image/i.test(text(doc.body).slice(0, 3000));
  }

  function isNotFound(doc) {
    return /page not found|looking for something\?/i.test(doc.title || "");
  }

  const sellerIdFromHref = (href) => {
    const m = String(href ?? "").match(/[?&](?:seller|merchant|me)=([A-Z0-9]{8,20})/);
    return m ? m[1] : null;
  };

  const discount = (price, mrp) => (price && mrp && mrp > price ? Math.round((1 - price / mrp) * 100) : null);

  // ---------------------------------------------------------------- search results & seller storefront

  function cardIsSponsored(card) {
    return (
      !!q(card, ".puis-sponsored-label-text, .s-sponsored-label-text, [data-component-type='sp-sponsored-result']") ||
      card.classList.contains("AdHolder") ||
      /^\s*Sponsored\b/.test(text(q(card, ".puis-label-popover, .s-label-popover-default")))
    );
  }

  /**
   * Listings in page order with their overall position, organic rank and
   * sponsored rank on this page. Pass the page number to label rows.
   */
  function parseSearch(doc, page) {
    const cards = Array.from(doc.querySelectorAll('div[data-component-type="s-search-result"][data-asin]')).filter((c) => (c.getAttribute("data-asin") || "").trim());
    let organic = 0;
    let sponsored = 0;
    const seen = new Set();
    const rows = cards.map((card, i) => {
      const asin = card.getAttribute("data-asin").trim();
      const isSp = cardIsSponsored(card);
      const rank = isSp ? ++sponsored : ++organic;

      // Newer layout: brand in a small h2 above the title h2.
      const h2s = Array.from(card.querySelectorAll("h2"));
      let brand = null;
      let title = null;
      const titleH2 = q(card, "a h2, h2 a, [data-cy='title-recipe'] a h2");
      if (h2s.length > 1) {
        brand = text(h2s[0]) || null;
        title = text(titleH2 || h2s[h2s.length - 1]) || null;
      } else {
        title = text(titleH2 || h2s[0]) || null;
      }

      const price = num(text(q(card, ".a-price:not(.a-text-price) .a-offscreen")));
      const mrp = num(text(q(card, ".a-price.a-text-price .a-offscreen")));
      const ratingEl = q(card, "i.a-icon-star-small .a-icon-alt, i.a-icon-star-mini .a-icon-alt, i[class*='a-star'] .a-icon-alt, .a-icon-alt");
      const reviewsEl = q(card, "a[href*='customerReviews'] span.a-size-base, [data-cy='reviews-block'] span.a-size-base.s-underline-text, span.a-size-base.s-underline-text");
      const reviewsLabel = q(card, "span[aria-label$='ratings'], span[aria-label$='rating']");
      const cardText = text(card);
      const bought = cardText.match(/([\d.,]+[KkMm]?\+?)\s*bought in past month/i);
      const badges = Array.from(card.querySelectorAll(".a-badge-text, .a-badge-label-inner, [data-component-type='s-status-badge-component'] .a-badge-text"))
        .map(text)
        .filter(Boolean);
      const dup = seen.has(asin);
      seen.add(asin);
      return {
        page: page || 1,
        position: i + 1,
        type: isSp ? "Sponsored" : "Organic",
        organicRank: isSp ? null : rank,
        sponsoredRank: isSp ? rank : null,
        duplicate: dup,
        asin,
        title,
        brand,
        price,
        mrp,
        discountPct: discount(price, mrp),
        rating: num(ratingEl ? text(ratingEl) : null),
        reviews: reviewsEl ? count(text(reviewsEl)) : reviewsLabel ? count(reviewsLabel.getAttribute("aria-label")) : null,
        boughtPastMonth: bought ? bought[1] : null,
        badges: [...new Set(badges)].join(" | ") || null,
        prime: !!q(card, "i.a-icon-prime, [aria-label='Amazon Prime']"),
        image: q(card, "img.s-image")?.getAttribute("src") || null,
      };
    });
    const next = q(doc, "a.s-pagination-next");
    const hasNext = !!next && !next.classList.contains("s-pagination-disabled");
    const pageFromDom = num(text(q(doc, ".s-pagination-selected")));
    return { rows, hasNext, page: pageFromDom || page || 1 };
  }

  // ---------------------------------------------------------------- product page

  function productDetails(doc) {
    const out = {};
    const put = (k, v) => {
      const key = clean(k).replace(/\s*:\s*$/, "").trim();
      const val = clean(v).replace(/^:\s*/, "");
      if (key && val && !(key in out)) out[key] = val;
    };
    doc.querySelectorAll("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li").forEach((li) => {
      const bold = q(li, "span.a-text-bold");
      if (!bold) return;
      const label = bold.textContent;
      let value = "";
      for (let n = bold.nextSibling; n; n = n.nextSibling) value += " " + n.textContent;
      if (!clean(value)) value = li.textContent.replace(label, "");
      put(label, value);
    });
    doc
      .querySelectorAll(
        "#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_detailBullets_sections1 tr, #prodDetails tr, #technicalSpecifications_section_1 tr",
      )
      .forEach((tr) => put(text(q(tr, "th")), text(q(tr, "td"))));
    return out;
  }

  const pick = (d, ...res) => {
    for (const r of res) {
      const k = Object.keys(d).find((key) => r.test(key));
      if (k) return d[k];
    }
    return null;
  };

  /** "#45 in Sports (See Top 100 in Sports) #2 in Yoga Mats" -> main rank, category, sub-ranks */
  function parseBsr(s) {
    if (!s) return { bsr: null, bsrCategory: null, subRanks: null };
    const ranks = [...clean(s).replace(/\(\s*See Top 100[^)]*\)/gi, "").matchAll(/#\s?([\d,]+)\s+in\s+([^#(]+)/g)].map((m) => ({ rank: num(m[1]), cat: clean(m[2]) }));
    if (!ranks.length) return { bsr: null, bsrCategory: null, subRanks: null };
    return {
      bsr: ranks[0].rank,
      bsrCategory: ranks[0].cat,
      subRanks: ranks.slice(1).map((r) => `#${r.rank} in ${r.cat}`).join(" | ") || null,
    };
  }

  function imageCount(doc) {
    const thumbs = doc.querySelectorAll("#altImages li.imageThumbnail, #altImages li.item.imageThumbnail").length;
    if (thumbs) return thumbs;
    // Fetched pages keep the gallery in a script: 'colorImages': { 'initial': [ {...hiRes...}, ... ] }
    for (const s of doc.querySelectorAll("script")) {
      const m = (s.textContent || "").match(/'colorImages':\s*\{\s*'initial':\s*(\[[\s\S]*?\])\s*\}/);
      if (m) return (m[1].match(/"hiRes"/g) || []).length || null;
    }
    return null;
  }

  function hasVideo(doc) {
    if (q(doc, "#altImages li.videoThumbnail, #altImages .videoCountTemplate, #ive-hero-video-player, [data-csa-c-content-id*='video']")) return true;
    for (const s of doc.querySelectorAll("script")) {
      const c = s.textContent || "";
      if (/"videos"\s*:\s*\[\s*\{/.test(c) || /"videoCount"\s*:\s*[1-9]/.test(c)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- listing signals

  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  /** "12 March 2022" / "March 12, 2022" / "12 Mar 2022" -> "2022-03-12" (null if unreadable). */
  function isoDate(s) {
    const v = clean(s).toLowerCase().replace(/,/g, "");
    const m = v.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/) || v.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/);
    if (!m) return null;
    const [day, mon] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
    const mi = MONTHS.findIndex((x) => x.startsWith(mon.slice(0, 3)));
    if (mi < 0) return null;
    return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  /** Whole days from an ISO date to `now`. */
  const daysSince = (iso, now = Date.now()) => (iso ? Math.max(0, Math.floor((now - Date.parse(iso + "T00:00:00+05:30")) / 864e5)) : null);

  const DEAL = /(Lightning Deal|Deal of the Day|Prime Day Deal|Prime Exclusive Deal|Great Indian Festival(?: Deal)?|Great Freedom Festival(?: Deal)?|Great Summer Sale(?: Deal)?|Great Republic Day Sale(?: Deal)?|Limited time deal|Blockbuster Deal|Mega Deal|Deal)/i;

  /** "Apply ₹50 coupon", "Apply 5% voucher", "Save 10% with coupon" -> { percent, amount }, each derived from the other with the price. */
  function parseCoupon(s, price) {
    const v = clean(s);
    if (!v || !/coupon|voucher/i.test(v)) return null;
    const m = v.match(/(₹\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s?%)\s*(?:off\s*)?(?:with\s+)?(?:coupon|voucher)/i) || v.match(/(?:coupon|voucher)[^₹\d]{0,20}(₹\s?[\d,]+(?:\.\d+)?|\d+(?:\.\d+)?\s?%)/i);
    if (!m) return { percent: null, amount: null };
    if (m[1].includes("%")) {
      const percent = num(m[1]);
      return { percent, amount: percent != null && price ? Math.round(price * percent) / 100 : null };
    }
    const amount = num(m[1]);
    return { percent: amount != null && price ? Math.round((amount / price) * 1000) / 10 : null, amount };
  }

  /** Badges, coupon, deal and delivery promise from a product page. */
  function listingSignals(doc, price) {
    const badges = [];
    const add = (b) => {
      const v = clean(b);
      if (v && !badges.some((x) => x.toLowerCase() === v.toLowerCase())) badges.push(v.slice(0, 80));
    };
    if (/amazon'?s\s*choice/i.test(t(doc, "#acBadge_feature_div, .ac-badge-wrapper") || "") || q(doc, "#acBadge_feature_div .ac-badge-rectangle")) add("Amazon's Choice");
    const bs = t(doc, "#zeitgeistBadge_feature_div, .zg-badge-wrapper, #bestSellerBadge_feature_div") || "";
    if (/best\s*seller/i.test(bs)) add((bs.match(/#\s?\d+\s+Best\s*Seller(?:\s+in\s+.+)?/i) || ["Best Seller"])[0]);
    const bought = (t(doc, "#social-proofing-faceout-title-tk_bought, #socialProofingAsinFaceout_feature_div, [id^='social-proofing-faceout-title']") || "").match(/([\d.,]+\s*[KkMm]?\+?)\s*bought in past month/i);
    if (bought) add(`${clean(bought[1])} bought in past month`);
    if (/top brand/i.test(text(q(doc, "#brandInsights_feature_div_3, #brandInsights_feature_div, [id^='brandInsights']")))) add("Top Brand");
    if (q(doc, "#apex_desktop i.a-icon-prime, #corePriceDisplay_desktop_feature_div i.a-icon-prime, #deliveryBlockMessage i.a-icon-prime, #primeBadge")) add("Prime");
    const low = (t(doc, "#availability") || "").match(/only\s+(\d+)\s+left in stock/i);
    if (low) add(`Only ${low[1]} left in stock`);
    if (/new launch/i.test(text(q(doc, "#newLaunchBadge_feature_div, #newLaunch_feature_div")))) add("New Launch");

    const dealText = ["#dealBadge_feature_div", "#dealBadgeSupportingText", "#apex_desktop .dealBadge", "#corePriceDisplay_desktop_feature_div .dealBadge", "#dealsAccordionRow", "#goldboxBuyBox"].map((sel) => t(doc, sel)).find(Boolean);
    const deal = (dealText && (dealText.match(DEAL) || [])[1]) || null;

    // Amazon inlines a <style> block in the coupon badge; read text without it.
    const plain = (el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll("style, script").forEach((x) => x.remove());
      return text(c);
    };
    const couponTexts = Array.from(doc.querySelectorAll("#promoPriceBlockMessage_feature_div, #couponBadgeRegularVpc, #vpcButton, [id^='couponText'], [id^='couponBadge'], #promotions_feature_div, #couponFeature, .couponLabelText"))
      .map(plain)
      .filter((v) => /coupon|voucher/i.test(v));
    const coupon = couponTexts.map((v) => parseCoupon(v, price)).find((c) => c && (c.percent != null || c.amount != null)) || (couponTexts[0] ? parseCoupon(couponTexts[0], price) : null);
    const couponLabel = !coupon ? null : coupon.percent != null ? `${coupon.percent}%${coupon.amount != null ? ` (₹${coupon.amount})` : ""}` : coupon.amount != null ? `₹${coupon.amount}` : "Coupon";

    const primary = q(doc, "#mir-layout-DELIVERY_BLOCK-slot-PRIMARY_DELIVERY_MESSAGE_LARGE");
    const secondary = q(doc, "#mir-layout-DELIVERY_BLOCK-slot-SECONDARY_DELIVERY_MESSAGE_LARGE");
    const attr = (el, a) => clean(el && q(el, `[${a}]`)?.getAttribute(a)) || null;
    const delivery = attr(primary, "data-csa-c-delivery-time") || (primary && t(primary, ".a-text-bold")) || t(doc, "#delivery-message .a-text-bold, #ddmDeliveryMessage .a-text-bold");
    const deliveryCharge = attr(primary, "data-csa-c-delivery-price") || (/free delivery/i.test(text(primary)) ? "FREE" : null);
    const fastest = attr(secondary, "data-csa-c-delivery-time") || (secondary && t(secondary, ".a-text-bold")) || null;

    return {
      badges,
      boughtPastMonth: bought ? count(bought[1]) : null,
      deal,
      coupon: couponLabel,
      couponPercent: coupon ? coupon.percent : null,
      couponAmount: coupon ? coupon.amount : null,
      delivery,
      deliveryCharge,
      fastestDelivery: fastest,
      deliverTo: t(doc, "#glow-ingress-line2"),
    };
  }

  // Amazon sometimes puts a "Learn more about the seller" link next to (or instead of) the store name.
  const GENERIC_SELLER = /^(sold by|learn more|see more|see all|details|visit|view|seller information|more information|about the seller)\b|learn more about/i;
  function sellerName(candidates) {
    for (const c of candidates) {
      const name = clean(String(c || "").replace(/^sold by\s*:?\s*/i, "").replace(/\s*(learn more about (the )?seller|seller information|details)\s*\.?$/i, ""));
      if (name && !GENERIC_SELLER.test(name)) return name;
    }
    return null;
  }

  function parseProduct(doc, asin) {
    const d = productDetails(doc);
    const byline = t(doc, "#bylineInfo") || "";
    const brand = pick(d, /^brand$/i, /^brand name$/i) || (byline.match(/^Visit the (.+?) Store$/i) || [])[1] || (byline.match(/^Brand:\s*(.+)$/i) || [])[1] || null;

    const sellerLink = q(doc, "#sellerProfileTriggerId");
    const merchantLink = q(doc, '#merchant-info a[href*="seller="], #tabular-buybox a[href*="seller="], #merchantInfoFeature_feature_div a[href*="seller="]');
    const soldBy = sellerName([
      text(sellerLink),
      ...Array.from(doc.querySelectorAll('#merchant-info a[href*="seller="], #tabular-buybox a[href*="seller="], #merchantInfoFeature_feature_div a[href*="seller="], [offer-display-feature-name="desktop-merchant-info"] a[href*="seller="]')).map(text),
      t(doc, '#tabular-buybox [tabular-attribute-name="Sold by"] .tabular-buybox-text'),
      t(doc, '[offer-display-feature-name="desktop-merchant-info"] .offer-display-feature-text-message'),
      t(doc, "#merchantInfoFeature_feature_div .offer-display-feature-text-message"),
      t(doc, "#merchantInfoFeature_feature_div .offer-display-feature-text"),
    ]);
    const sellerId = sellerIdFromHref(sellerLink?.getAttribute("href")) || sellerIdFromHref(merchantLink?.getAttribute("href")) || q(doc, "#merchantID, input[name='merchantID']")?.getAttribute("value") || null;
    const shipsFrom =
      t(doc, '#tabular-buybox [tabular-attribute-name="Ships from"] .tabular-buybox-text') ||
      t(doc, "#fulfillerInfoFeature_feature_div .offer-display-feature-text") ||
      null;
    const merchantInfo = t(doc, "#merchant-info") || "";
    const amazonShips = /amazon/i.test(shipsFrom || "") || /fulfilled by amazon/i.test(merchantInfo);
    const amazonSells = /^amazon/i.test(soldBy || "");
    const fulfillment = !soldBy ? null : amazonSells ? "Amazon" : amazonShips ? "FBA" : shipsFrom || merchantInfo ? "FBM" : null;

    const price = num(t(doc, "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen, #corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice"));
    const mrp = num(t(doc, "#corePriceDisplay_desktop_feature_div .basisPrice .a-offscreen, #corePriceDisplay_desktop_feature_div .a-text-price .a-offscreen, #corePrice_desktop .a-text-price .a-offscreen"));
    // Several blocks can mention offers ("See All Buying Options", "New (4) from ₹…"); read them all.
    const offersText = Array.from(doc.querySelectorAll("#olpLinkWidget_feature_div, #buybox-see-all-buying-choices, #olp_feature_div, #aod-ingress-link")).map(text).join(" ");
    const offers = offersText.match(/\((\d+)\)/) || offersText.match(/(\d+)\s+(?:new\s+)?offers?/i);
    const aplus = q(doc, "#aplus, #aplus_feature_div, #aplusBrandStory_feature_div");
    const availability = t(doc, "#availability") || t(doc, "#outOfStock");
    const bsr = parseBsr(pick(d, /best ?sellers rank/i));

    return {
      asin,
      title: t(doc, "#productTitle"),
      brand: brand ? clean(brand) : null,
      storeLink: q(doc, "#bylineInfo")?.getAttribute("href") || null,
      price,
      mrp,
      discountPct: discount(price, mrp),
      rating: num(q(doc, "#acrPopover")?.getAttribute("title") || t(doc, "#acrPopover .a-icon-alt")),
      reviews: count(t(doc, "#acrCustomerReviewText")),
      buyboxSeller: soldBy,
      sellerId,
      shipsFrom,
      fulfillment,
      buyboxWon: !!q(doc, "#add-to-cart-button, #buy-now-button"),
      otherOffers: offers ? Number(offers[1]) : null,
      availability,
      ...bsr,
      manufacturer: pick(d, /^manufacturer$/i, /^manufacturer contact/i, /^manufactured by$/i),
      packer: pick(d, /^packer$/i, /^packed by$/i),
      importer: pick(d, /^importer$/i, /^imported by$/i),
      countryOfOrigin: pick(d, /^country of origin$/i),
      dateFirstAvailable: pick(d, /^date first available$/i),
      listingDate: isoDate(pick(d, /^date first available$/i)),
      listingAgeDays: daysSince(isoDate(pick(d, /^date first available$/i))),
      modelNumber: pick(d, /^item model number$/i, /^model number$/i, /^model$/i),
      partNumber: pick(d, /^item part number$/i, /^part number$/i),
      genericName: pick(d, /^generic name$/i),
      netQuantity: pick(d, /^net quantity$/i),
      itemWeight: pick(d, /^item weight$/i, /^weight$/i),
      dimensions: pick(d, /^product dimensions$/i, /^item dimensions/i, /^package dimensions$/i),
      department: pick(d, /^department$/i),
      bullets: Array.from(doc.querySelectorAll("#feature-bullets li span.a-list-item")).map(text).filter(Boolean).join(" | ") || null,
      ...listingSignals(doc, price),
      imageCount: imageCount(doc),
      hasAplus: !!aplus && clean(aplus.textContent).replace(/\s/g, "").length > 80,
      hasVideo: hasVideo(doc),
      bulletCount: doc.querySelectorAll("#feature-bullets li span.a-list-item").length,
    };
  }

  // ---------------------------------------------------------------- seller profile

  const IN_STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
    "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
    "Uttar Pradesh", "Uttarakhand", "West Bengal",
  ];

  function addressParts(lines) {
    const joined = lines.join(", ");
    const pincode = (joined.match(/\b[1-9]\d{2}\s?\d{3}\b/) || [""])[0].replace(/\s/g, "") || null;
    const lower = joined.toLowerCase();
    const state = IN_STATES.find((s) => lower.includes(s.toLowerCase())) || (/\bnew delhi\b/i.test(joined) ? "Delhi" : null);
    const parts = lines.flatMap((l) => l.split(",")).map(clean).filter(Boolean);
    let city = null;
    const i = state ? parts.findIndex((p) => p.toLowerCase() === state.toLowerCase()) : -1;
    if (i > 0 && !/^\d+$/.test(parts[i - 1])) city = parts[i - 1];
    return { city, state, pincode };
  }

  function parseSeller(doc, sellerId) {
    const section = q(doc, "#page-section-detail-seller-info");
    let businessName = null;
    const lines = [];
    if (section) {
      section.querySelectorAll("span.a-text-bold").forEach((el) => {
        const label = text(el);
        const row = el.closest("div.a-row");
        let after = "";
        for (let n = el.nextSibling; n; n = n.nextSibling) after += " " + n.textContent;
        if (/^Business Name/i.test(label)) {
          businessName = clean(after) || (row ? clean(row.textContent.replace(el.textContent, "")) : "") || null;
        } else if (/^Business Address/i.test(label)) {
          if (clean(after)) lines.push(clean(after));
          for (let r = row && row.nextElementSibling; r && r.classList.contains("indent-left"); r = r.nextElementSibling) {
            if (text(r)) lines.push(text(r));
          }
        }
      });
      if (!businessName) {
        const all = text(section);
        businessName = (all.match(/Business Name:\s*(.+?)\s*(?:Business Address:|$)/i) || [])[1] || null;
        if (!lines.length) {
          const addr = (all.match(/Business Address:\s*(.+)$/i) || [])[1];
          if (addr) lines.push(addr);
        }
      }
    }
    const feedback = t(doc, "#seller-info-feedback-summary, #effective-timeperiod-rating-year-description, #feedback-summary-table") || "";
    const ratingsText = text(q(doc, "#seller-info-feedback-summary")) || text(q(doc, "#rating-365d-num")) || text(q(doc, "#feedback-summary-table"));
    return {
      sellerId,
      storeName: t(doc, "#seller-name, #sellerName-rd, #sellerName h1, h1#sellerName"),
      businessName: businessName ? clean(businessName) : null,
      businessAddress: lines.length ? lines.join(", ") : null,
      ...addressParts(lines),
      sellerRating: num((feedback.match(/(\d(?:\.\d)?)\s*out of 5/i) || [])[1]),
      sellerRatingsCount: count((ratingsText.match(/([\d,]+)\s*ratings?/i) || [])[1]),
    };
  }

  /** What kind of amazon.in page this is. */
  function pageKind(loc) {
    const u = new URL(loc.href);
    if (/\/(dp|gp\/product)\/[A-Z0-9]{10}/.test(u.pathname)) return "product";
    if (u.pathname === "/s" && u.searchParams.get("me")) return "storefront";
    if (u.pathname === "/s" || u.pathname.startsWith("/s/")) return "search";
    if (u.pathname === "/sp") return "seller";
    return "other";
  }

  const asinFromUrl = (href) => (String(href).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1] || null;

  root.AxParse = { clean, num, count, isoDate, daysSince, parseCoupon, listingSignals, isCaptcha, isNotFound, parseSearch, parseProduct, parseSeller, parseBsr, addressParts, sellerIdFromHref, pageKind, asinFromUrl };
})(typeof window !== "undefined" ? window : globalThis);

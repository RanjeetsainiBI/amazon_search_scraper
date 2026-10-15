import * as cheerio from "cheerio";

/**
 * Pure HTML parsers for amazon.in pages. They take raw HTML (from Playwright's
 * page.content()) so they can be tested offline against fixtures. Each one
 * tries the current desktop layout first, then older fallbacks.
 */

/** Removes the invisible direction marks Amazon puts around labels, collapses whitespace. */
export const clean = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/[‎‏‪-‮ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const num = (s: string | null | undefined): number | null => {
  const m = String(s ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};

/** "1.2K" / "12,345" / "(3,210)" -> number. */
export const count = (s: string | null | undefined): number | null => {
  const t = clean(s).replace(/[(),]/g, "");
  const m = t.match(/(\d+(?:\.\d+)?)\s*([KkMm])?/);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2] ? (/k/i.test(m[2]) ? 1_000 : 1_000_000) : 1;
  return Math.round(n * mult);
};

export function isBlocked(html: string): boolean {
  return /validateCaptcha|Robot Check|Type the characters you see in this image|api-services-support@amazon\.com/i.test(html);
}

export function isNotFound(html: string): boolean {
  return /Page Not Found|Looking for something\?/i.test(cheerio.load(html)("title").text());
}

// ---------------------------------------------------------------- search

export interface SearchResult {
  asin: string;
  position: number;
  title: string;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  sponsored: boolean;
}

export function parseSearch(html: string): { results: SearchResult[]; hasNext: boolean } {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $('div[data-component-type="s-search-result"][data-asin]').each((_, el) => {
    const card = $(el);
    const asin = card.attr("data-asin")?.trim();
    if (!asin) return;
    const title = clean(card.find("h2").first().text()) || clean(card.find('[data-cy="title-recipe"]').text());
    const ratingText = card.find("i.a-icon-star-small .a-icon-alt, i.a-icon-star-mini .a-icon-alt, .a-icon-alt").first().text();
    const reviewsText =
      card.find('a[href*="customerReviews"] span.a-size-base, [data-cy="reviews-block"] span.a-size-base.s-underline-text, span.a-size-base.s-underline-text').first().text() ||
      card.find('span[aria-label$="ratings"], span[aria-label$="rating"]').first().attr("aria-label");
    const sponsored =
      card.find(".puis-sponsored-label-text, .s-sponsored-label-text").length > 0 ||
      /\bSponsored\b/.test(card.find(".puis-label-popover, .a-color-secondary").first().text());
    results.push({
      asin,
      position: results.length + 1,
      title,
      price: num(card.find(".a-price:not(.a-text-price) .a-offscreen").first().text()),
      rating: num(ratingText),
      reviews: reviewsText ? count(reviewsText) : null,
      sponsored,
    });
  });
  const next = $("a.s-pagination-next").first();
  const hasNext = next.length > 0 && !next.hasClass("s-pagination-disabled");
  return { results, hasNext };
}

// ---------------------------------------------------------------- product

export interface ProductInfo {
  asin: string;
  title: string | null;
  brand: string | null;
  price: number | null;
  rating: number | null;
  reviews: number | null;
  sellerName: string | null;
  sellerId: string | null;
  manufacturer: string | null;
  packer: string | null;
  importer: string | null;
  countryOfOrigin: string | null;
  bestSellersRank: string | null;
  /** Every label/value pair from the product details sections, for anything not mapped above. */
  details: Record<string, string>;
}

/** Collects "label : value" pairs from the bullet list and the tables Amazon uses for product details. */
export function productDetails($: cheerio.CheerioAPI): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (k: string, v: string) => {
    const key = clean(k).replace(/\s*:\s*$/, "").trim();
    const val = clean(v).replace(/^:\s*/, "");
    if (key && val && !(key in out)) out[key] = val;
  };
  $("#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li").each((_, li) => {
    const bold = $(li).find("span.a-text-bold").first();
    if (!bold.length) return;
    const label = bold.text();
    const value = bold.nextAll("span").text() || $(li).text().replace(label, "");
    put(label, value);
  });
  $(
    "#productDetails_techSpec_section_1 tr, #productDetails_techSpec_section_2 tr, #productDetails_detailBullets_sections1 tr, #prodDetails tr, #technicalSpecifications_section_1 tr",
  ).each((_, tr) => {
    put($(tr).find("th").first().text(), $(tr).find("td").first().text());
  });
  return out;
}

const pick = (d: Record<string, string>, ...re: RegExp[]) => {
  for (const r of re) {
    const k = Object.keys(d).find((key) => r.test(key));
    if (k) return d[k];
  }
  return null;
};

export function sellerIdFromHref(href: string | null | undefined): string | null {
  const m = String(href ?? "").match(/[?&](?:seller|merchant|me)=([A-Z0-9]{8,20})/);
  return m ? m[1] : null;
}

export function parseProduct(html: string, asin: string): ProductInfo {
  const $ = cheerio.load(html);
  const details = productDetails($);
  const byline = clean($("#bylineInfo").text());
  const brand =
    pick(details, /^brand$/i, /^brand name$/i) ??
    (byline.match(/^Visit the (.+?) Store$/i)?.[1] ?? byline.match(/^Brand:\s*(.+)$/i)?.[1] ?? null);

  const sellerLink = $("#sellerProfileTriggerId").first();
  const merchantLink = $('#merchant-info a[href*="seller="], #tabular-buybox a[href*="seller="], #merchantInfoFeature_feature_div a[href*="seller="]').first();
  const sellerName =
    clean(sellerLink.text()) ||
    clean(merchantLink.text()) ||
    clean($('#tabular-buybox [tabular-attribute-name="Sold by"] .tabular-buybox-text').text()) ||
    clean($("#merchantInfoFeature_feature_div .offer-display-feature-text").first().text()) ||
    null;
  const sellerId =
    sellerIdFromHref(sellerLink.attr("href")) ??
    sellerIdFromHref(merchantLink.attr("href")) ??
    ($("#merchantID").attr("value") || $('input[name="merchantID"]').attr("value") || null);

  return {
    asin,
    title: clean($("#productTitle").text()) || null,
    brand: brand ? clean(brand) : null,
    price: num($("#corePrice_feature_div .a-price .a-offscreen, #corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #priceblock_ourprice").first().text()),
    rating: num($("#acrPopover").attr("title") ?? $("#acrPopover .a-icon-alt").first().text()),
    reviews: count($("#acrCustomerReviewText").first().text()),
    sellerName,
    sellerId,
    manufacturer: pick(details, /^manufacturer$/i, /^manufacturer contact/i, /^manufactured by$/i),
    packer: pick(details, /^packer$/i, /^packed by$/i),
    importer: pick(details, /^importer$/i, /^imported by$/i),
    countryOfOrigin: pick(details, /^country of origin$/i),
    bestSellersRank: pick(details, /best ?sellers rank/i)?.replace(/\s*\(See Top 100.*?\)/i, "") ?? null,
    details,
  };
}

// ---------------------------------------------------------------- seller profile

export interface SellerInfo {
  sellerId: string;
  storeName: string | null;
  businessName: string | null;
  businessAddress: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  rating: number | null;
  ratingsCount: number | null;
}

const IN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal",
];

/** Splits an Indian address into city / state / pincode where it can. */
export function addressParts(lines: string[]): { city: string | null; state: string | null; pincode: string | null } {
  const joined = lines.join(", ");
  const pincode = joined.match(/\b[1-9]\d{2}\s?\d{3}\b/)?.[0].replace(/\s/g, "") ?? null;
  const lower = joined.toLowerCase();
  const state = IN_STATES.find((s) => lower.includes(s.toLowerCase())) ?? (/\bnew delhi\b/i.test(joined) ? "Delhi" : null);
  // Amazon prints the address one part per line, usually "... , City, State, PIN, IN".
  const parts = lines.flatMap((l) => l.split(",")).map(clean).filter(Boolean);
  let city: string | null = null;
  const stateIdx = state ? parts.findIndex((p) => p.toLowerCase() === state.toLowerCase()) : -1;
  if (stateIdx > 0) city = parts[stateIdx - 1];
  if (city && /^\d+$/.test(city)) city = null;
  return { city, state, pincode };
}

export function parseSeller(html: string, sellerId: string): SellerInfo {
  const $ = cheerio.load(html);
  const section = $("#page-section-detail-seller-info").first();

  let businessName: string | null = null;
  const addressLines: string[] = [];
  if (section.length) {
    section.find("span.a-text-bold").each((_, el) => {
      const label = clean($(el).text());
      const row = $(el).closest("div.a-row");
      if (/^Business Name/i.test(label)) {
        businessName = clean($(el).nextAll("span").text()) || clean(row.text().replace($(el).text(), "")) || null;
      } else if (/^Business Address/i.test(label)) {
        const inline = clean($(el).nextAll("span").text());
        if (inline) addressLines.push(inline);
        row.nextAll("div.indent-left, div.a-row.indent-left").each((_, r) => {
          const t = clean($(r).text());
          if (t) addressLines.push(t);
        });
      }
    });
    if (!businessName) {
      const text = clean(section.text());
      businessName = text.match(/Business Name:\s*(.+?)\s*(?:Business Address:|$)/i)?.[1] ?? null;
      if (!addressLines.length) {
        const addr = text.match(/Business Address:\s*(.+)$/i)?.[1];
        if (addr) addressLines.push(addr);
      }
    }
  }

  const feedback = clean($("#seller-info-feedback-summary, #effective-timeperiod-rating-year-description, #feedback-summary-table").first().text());
  const ratingsText = clean($("#seller-info-feedback-summary, #rating-365d-num, #feedback-summary-table").text());
  return {
    sellerId,
    storeName: clean($("#seller-name, #sellerName-rd, #sellerName h1, h1#sellerName").first().text()) || null,
    businessName: businessName ? clean(businessName) : null,
    businessAddress: addressLines.length ? addressLines.join(", ") : null,
    ...addressParts(addressLines),
    rating: num(feedback.match(/(\d(?:\.\d)?)\s*out of 5/i)?.[1]),
    ratingsCount: count(ratingsText.match(/([\d,]+)\s*ratings?/i)?.[1]),
  };
}

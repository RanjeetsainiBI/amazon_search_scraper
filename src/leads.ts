import type { ProductInfo, SearchResult, SellerInfo } from "./parse.ts";

/** One scraped product, as kept in the run state. */
export interface ProductRow extends ProductInfo {
  keyword: string;
  searchPage: number;
  position: number;
  sponsored: boolean;
  scrapedAt: string;
}

export const PRODUCT_HEADER = [
  "keyword", "search_page", "position", "sponsored", "asin", "title", "brand", "price_inr", "rating", "reviews",
  "seller_name", "seller_id", "manufacturer", "packer", "importer", "country_of_origin", "best_sellers_rank",
  "product_url", "scraped_at",
];

export const productLine = (p: ProductRow) => [
  p.keyword, p.searchPage, p.position, p.sponsored, p.asin, p.title, p.brand, p.price, p.rating, p.reviews,
  p.sellerName, p.sellerId, p.manufacturer, p.packer, p.importer, p.countryOfOrigin, p.bestSellersRank,
  `https://www.amazon.in/dp/${p.asin}`, p.scrapedAt,
];

export const LEAD_HEADER = [
  "seller_id", "store_name", "business_name", "business_address", "city", "state", "pincode",
  "seller_rating", "seller_ratings_count", "brands", "manufacturers", "packers", "importers",
  "keywords", "products_found", "sponsored_products", "total_reviews", "avg_product_rating", "price_min_inr", "price_max_inr",
  "top_product_asin", "top_product_title", "sample_asins", "seller_profile_url", "storefront_url",
];

const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.map((x) => (x ?? "").trim()).filter(Boolean))];
const join = (xs: (string | null | undefined)[], max = 5) => uniq(xs).slice(0, max).join(" | ");

/** Rolls products up into one row per seller: the unit you actually reach out to. */
export function buildLeads(products: ProductRow[], sellers: Record<string, SellerInfo>) {
  const bySeller = new Map<string, ProductRow[]>();
  for (const p of products) {
    if (!p.sellerId) continue;
    const list = bySeller.get(p.sellerId) ?? [];
    list.push(p);
    bySeller.set(p.sellerId, list);
  }
  const rows: (string | number | null)[][] = [];
  for (const [id, list] of bySeller) {
    const s = sellers[id];
    const top = [...list].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0))[0];
    const rated = list.filter((p) => p.rating != null);
    const prices = list.map((p) => p.price).filter((x): x is number => x != null);
    rows.push([
      id,
      s?.storeName ?? list[0].sellerName,
      s?.businessName ?? null,
      s?.businessAddress ?? null,
      s?.city ?? null,
      s?.state ?? null,
      s?.pincode ?? null,
      s?.rating ?? null,
      s?.ratingsCount ?? null,
      join(list.map((p) => p.brand)),
      join(list.map((p) => p.manufacturer), 3),
      join(list.map((p) => p.packer), 3),
      join(list.map((p) => p.importer), 3),
      join(list.map((p) => p.keyword), 10),
      list.length,
      list.filter((p) => p.sponsored).length,
      list.reduce((n, p) => n + (p.reviews ?? 0), 0),
      rated.length ? Math.round((rated.reduce((n, p) => n + (p.rating ?? 0), 0) / rated.length) * 10) / 10 : null,
      prices.length ? Math.min(...prices) : null,
      prices.length ? Math.max(...prices) : null,
      top.asin,
      top.title,
      uniq(list.map((p) => p.asin)).slice(0, 10).join(" "),
      `https://www.amazon.in/sp?seller=${id}`,
      `https://www.amazon.in/s?me=${id}`,
    ]);
  }
  // Busiest sellers first: more products in your keywords usually means a bigger ad budget.
  return rows.sort((a, b) => Number(b[14]) - Number(a[14]) || Number(b[16]) - Number(a[16]));
}

export interface Filters {
  minReviews?: number;
  maxReviews?: number;
  minPrice?: number;
  maxPrice?: number;
  maxRating?: number;
  sponsoredOnly?: boolean;
}

/** Search-card filters, applied before opening the product page so skipped products cost nothing. */
export function passesFilters(r: SearchResult, f: Filters): boolean {
  if (f.sponsoredOnly && !r.sponsored) return false;
  if (f.minReviews != null && (r.reviews ?? 0) < f.minReviews) return false;
  if (f.maxReviews != null && (r.reviews ?? 0) > f.maxReviews) return false;
  if (f.minPrice != null && (r.price == null || r.price < f.minPrice)) return false;
  if (f.maxPrice != null && (r.price == null || r.price > f.maxPrice)) return false;
  if (f.maxRating != null && r.rating != null && r.rating > f.maxRating) return false;
  return true;
}

/** Amazon's own retail and its joint-venture sellers in India: not prospects. */
export const AMAZON_SELLER = /^(amazon(\.in)?|amazon retail|cloudtail|appario|clicktech|etrade marketing|rk world ?info ?com)/i;

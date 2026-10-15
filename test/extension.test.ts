import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// Loads the extension's classic scripts into a jsdom window, the way Chrome loads content scripts.
const win = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://www.amazon.in/s?k=yoga+mat", runScripts: "outside-only" }).window;
for (const f of ["parse.js", "scan.js"]) win.eval(readFileSync(new URL(`../extension/${f}`, import.meta.url), "utf8"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const P = (win as any).AxParse;
// Objects made inside jsdom live in another realm; copy them before deep-equal checks.
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S = (win as any).AxScan;
const doc = (name: string) => new win.DOMParser().parseFromString(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"), "text/html");

test("search: organic and sponsored ranks are counted separately", () => {
  const { rows, hasNext, page } = P.parseSearch(doc("ext-search.html"), 1);
  assert.equal(rows.length, 5);
  assert.equal(hasNext, true);
  assert.equal(page, 1);
  const pick = (r: Record<string, unknown>) => [r.position, r.type, r.organicRank, r.sponsoredRank];
  assert.deepEqual(plain(rows.map(pick)), [
    [1, "Sponsored", null, 1],
    [2, "Organic", 1, null],
    [3, "Organic", 2, null],
    [4, "Sponsored", null, 2],
    [5, "Organic", 3, null],
  ]);
  assert.equal(rows[4].duplicate, true, "same ASIN twice on a page is flagged");
});

test("search card fields: brand row, MRP, discount, bought, badges, prime", () => {
  const [sp, org] = P.parseSearch(doc("ext-search.html"), 1).rows;
  assert.equal(sp.brand, "Boldfit");
  assert.equal(sp.title, "Yoga Mat 6mm Anti-Slip");
  assert.equal(sp.price, 599);
  assert.equal(sp.mrp, 1499);
  assert.equal(sp.discountPct, 60);
  assert.equal(sp.rating, 4.3);
  assert.equal(sp.reviews, 8210);
  assert.equal(sp.boughtPastMonth, "2K+");
  assert.equal(sp.prime, true);
  assert.equal(sp.image, "https://m.media-amazon.com/images/I/sp1.jpg");
  assert.equal(org.brand, null);
  assert.equal(org.title, "Strauss Yoga Mat 4mm");
  assert.equal(org.badges, "Best Seller");
  assert.equal(org.reviews, 15400);
  assert.equal(org.mrp, null);
});

test("ranks across pages continue from earlier pages", () => {
  const p1 = P.parseSearch(doc("ext-search.html"), 1).rows;
  const p2 = P.parseSearch(doc("ext-search.html"), 2).rows;
  const all = S.rankAcrossPages([...p1, ...p2]);
  assert.equal(all[5].sponsoredRankOverall, 3);
  assert.equal(all[6].organicRankOverall, 4);
  assert.equal(all[9].organicRankOverall, 6);
});

test("product: buy box, FBA, offers, BSR, manufacturer, A+, video, images", () => {
  const p = P.parseProduct(doc("ext-product.html"), "B0SP000001");
  assert.equal(p.title, "Boldfit Yoga Mat 6mm Anti-Slip");
  assert.equal(p.brand, "Boldfit");
  assert.equal(p.price, 599);
  assert.equal(p.mrp, 1499);
  assert.equal(p.discountPct, 60);
  assert.equal(p.rating, 4.3);
  assert.equal(p.reviews, 8210);
  assert.equal(p.buyboxSeller, "FitKart Retail");
  assert.equal(p.sellerId, "A1B2C3D4E5F6G7");
  assert.equal(p.shipsFrom, "Amazon");
  assert.equal(p.fulfillment, "FBA");
  assert.equal(p.buyboxWon, true);
  assert.equal(p.otherOffers, 4);
  assert.equal(p.availability, "In stock");
  assert.equal(p.bsr, 1245);
  assert.equal(p.bsrCategory, "Sports, Fitness & Outdoors");
  assert.equal(p.subRanks, "#12 in Yoga Mats | #30 in Exercise Mats");
  assert.equal(p.manufacturer, "Boldfit Sports Pvt Ltd, Noida, Uttar Pradesh 201301");
  assert.equal(p.importer, "Boldfit Imports, Delhi");
  assert.equal(p.countryOfOrigin, "China");
  assert.equal(p.dateFirstAvailable, "12 March 2022");
  assert.equal(p.imageCount, 6, "counted from the gallery script when thumbnails aren't rendered");
  assert.equal(p.hasAplus, true);
  assert.equal(p.hasVideo, true);
  assert.equal(p.bulletCount, 3);
});

test("product: older layout from the CLI fixtures still parses", () => {
  const p = P.parseProduct(doc("product-table.html"), "B0BBBBBBB2");
  assert.equal(p.brand, "Strauss");
  assert.equal(p.sellerId, "AZZZZZZZZZZZ9");
  assert.equal(p.manufacturer, "Strauss International, Ludhiana, Punjab");
  assert.equal(p.hasVideo, false);
});

test("seller profile: account name, business name, address", () => {
  const s = P.parseSeller(doc("seller.html"), "A1B2C3D4E5F6G7");
  assert.equal(s.storeName, "FitKart Retail");
  assert.equal(s.businessName, "FITKART RETAIL PRIVATE LIMITED");
  assert.equal(s.businessAddress, "Unit 4, Okhla Phase 2, New Delhi, Delhi, 110020, IN");
  assert.equal(s.city, "New Delhi");
  assert.equal(s.pincode, "110020");
  assert.equal(s.sellerRating, 4.6);
  assert.equal(s.sellerRatingsCount, 8421);
});

test("page kinds, captcha, helpers", () => {
  const kind = (u: string) => P.pageKind(new URL(u));
  assert.equal(kind("https://www.amazon.in/s?k=yoga+mat"), "search");
  assert.equal(kind("https://www.amazon.in/s?me=A1B2C3D4E5F6G7&marketplaceID=A21TJRUUN4KGV"), "storefront");
  assert.equal(kind("https://www.amazon.in/Boldfit-Yoga/dp/B0SP000001/ref=sr_1_1"), "product");
  assert.equal(kind("https://www.amazon.in/gp/cart/view.html"), "other");
  assert.equal(P.isCaptcha(doc("captcha.html")), true);
  assert.equal(P.isCaptcha(doc("ext-product.html")), false);
  assert.deepEqual(plain(P.parseBsr("#3 in Home & Kitchen (See Top 100 in Home & Kitchen) #1 in Mats")), { bsr: 3, bsrCategory: "Home & Kitchen", subRanks: "#1 in Mats" });
  assert.equal(S.pageUrl("https://www.amazon.in/s?k=mat&page=2&ref=sr_pg_2", 3), "https://www.amazon.in/s?k=mat&page=3");
  assert.equal(S.pageUrl("https://www.amazon.in/s?k=mat&page=2", 1), "https://www.amazon.in/s?k=mat");
});

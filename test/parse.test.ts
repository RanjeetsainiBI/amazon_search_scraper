import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { escapeCell } from "../src/csv.ts";
import { AMAZON_SELLER, buildLeads, passesFilters, type ProductRow } from "../src/leads.ts";
import { addressParts, count, isBlocked, parseProduct, parseSearch, parseSeller, sellerIdFromHref } from "../src/parse.ts";

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

test("search page: cards, prices, ratings, sponsored, pagination", () => {
  const { results, hasNext } = parseSearch(fx("search.html"));
  assert.equal(results.length, 2, "empty data-asin slot is ignored");
  assert.deepEqual(results[0], { asin: "B0AAAAAAA1", position: 1, title: "Boldfit Yoga Mat for Women and Men, 6mm", price: 499, rating: 4.2, reviews: 12345, sponsored: true });
  assert.equal(results[1].price, 1049, "strike-through MRP is not the price");
  assert.equal(results[1].reviews, 1200);
  assert.equal(results[1].sponsored, false);
  assert.equal(hasNext, true);
  assert.equal(parseSearch(fx("search-last.html")).hasNext, false);
});

test("product page: bullet-list details", () => {
  const p = parseProduct(fx("product.html"), "B0AAAAAAA1");
  assert.equal(p.title, "Boldfit Yoga Mat for Women and Men, 6mm");
  assert.equal(p.brand, "Boldfit");
  assert.equal(p.price, 499);
  assert.equal(p.rating, 4.2);
  assert.equal(p.reviews, 12345);
  assert.equal(p.sellerName, "FitKart Retail");
  assert.equal(p.sellerId, "A1B2C3D4E5F6G7");
  assert.equal(p.manufacturer, "Boldfit Sports Pvt Ltd, Plot 12, Sector 5, Noida, Uttar Pradesh 201301");
  assert.equal(p.packer, "Boldfit Sports Pvt Ltd");
  assert.equal(p.countryOfOrigin, "India");
  assert.equal(p.bestSellersRank, "#45 in Sports, Fitness & Outdoors #2 in Yoga Mats");
});

test("product page: table details and tabular buy box", () => {
  const p = parseProduct(fx("product-table.html"), "B0BBBBBBB2");
  assert.equal(p.brand, "Strauss");
  assert.equal(p.sellerName, "Strauss Official");
  assert.equal(p.sellerId, "AZZZZZZZZZZZ9");
  assert.equal(p.manufacturer, "Strauss International, Ludhiana, Punjab");
  assert.equal(p.importer, "Strauss Imports LLP, Mumbai");
});

test("seller profile: business name, address, rating", () => {
  const s = parseSeller(fx("seller.html"), "A1B2C3D4E5F6G7");
  assert.equal(s.storeName, "FitKart Retail");
  assert.equal(s.businessName, "FITKART RETAIL PRIVATE LIMITED");
  assert.equal(s.businessAddress, "Unit 4, Okhla Phase 2, New Delhi, Delhi, 110020, IN");
  assert.equal(s.city, "New Delhi");
  assert.equal(s.state, "Delhi");
  assert.equal(s.pincode, "110020");
  assert.equal(s.rating, 4.6);
  assert.equal(s.ratingsCount, 8421);
});

test("seller profile without the detail block returns nulls, not garbage", () => {
  const s = parseSeller("<html><body><h1 id='seller-name'>X</h1></body></html>", "AX");
  assert.equal(s.businessName, null);
  assert.equal(s.businessAddress, null);
});

test("helpers", () => {
  assert.equal(isBlocked(fx("captcha.html")), true);
  assert.equal(isBlocked(fx("product.html")), false);
  assert.equal(count("(3.4K)"), 3400);
  assert.equal(sellerIdFromHref("/s?me=A3QWERTYUIOP12&marketplaceID=X"), "A3QWERTYUIOP12");
  assert.deepEqual(addressParts(["12 MG Road, Bengaluru, Karnataka, 560 001, IN"]), { city: "Bengaluru", state: "Karnataka", pincode: "560001" });
  assert.ok(AMAZON_SELLER.test("Cloudtail India"));
  assert.ok(!AMAZON_SELLER.test("FitKart Retail"));
  assert.equal(escapeCell('a "b", c'), '"a ""b"", c"');
  assert.equal(escapeCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
});

test("filters and lead roll-up", () => {
  const r = { asin: "X", position: 1, title: "", price: 500, rating: 4.5, reviews: 80, sponsored: false };
  assert.ok(passesFilters(r, {}));
  assert.ok(!passesFilters(r, { sponsoredOnly: true }));
  assert.ok(!passesFilters(r, { minReviews: 100 }));
  assert.ok(!passesFilters(r, { maxRating: 4.0 }));
  assert.ok(passesFilters(r, { minPrice: 300, maxPrice: 800 }));

  const base = parseProduct(fx("product.html"), "B0AAAAAAA1");
  const row = (asin: string, reviews: number, kw: string, sponsored: boolean): ProductRow => ({ ...base, asin, reviews, keyword: kw, searchPage: 1, position: 1, sponsored, scrapedAt: "" });
  const seller = parseSeller(fx("seller.html"), "A1B2C3D4E5F6G7");
  const leads = buildLeads([row("B01", 10, "yoga mat", true), row("B02", 900, "gym mat", false)], { A1B2C3D4E5F6G7: seller });
  assert.equal(leads.length, 1, "two products, one seller, one lead");
  const [lead] = leads;
  assert.equal(lead[2], "FITKART RETAIL PRIVATE LIMITED");
  assert.equal(lead[13], "yoga mat | gym mat");
  assert.equal(lead[14], 2);
  assert.equal(lead[15], 1);
  assert.equal(lead[20], "B02", "top product = most reviews");
});

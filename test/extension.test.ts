import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";

// Loads the extension's classic scripts into a jsdom window, the way Chrome loads content scripts.
const win = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://www.amazon.in/s?k=yoga+mat", runScripts: "outside-only" }).window;
for (const f of ["parse.js", "scan.js", "index-check.js", "product-track.js"]) win.eval(readFileSync(new URL(`../extension/${f}`, import.meta.url), "utf8"));
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

// ---------------------------------------------------------------- Index Checker

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const I = (win as any).AxIndex;

/** A search page whose results are the given cards ("S:" prefix = sponsored). */
const searchDoc = (cards: string[], hasNext = false) =>
  new win.DOMParser().parseFromString(
    `<html><body>${cards
      .map((c) => {
        const sp = c.startsWith("S:");
        const asin = sp ? c.slice(2) : c;
        return `<div data-component-type="s-search-result" data-asin="${asin}" class="${sp ? "AdHolder" : ""}"><h2><span>${asin}</span></h2></div>`;
      })
      .join("")}${hasNext ? '<a class="s-pagination-next">Next</a>' : ""}</body></html>`,
    "text/html",
  );

test("index: ASIN and keyword input parsing", () => {
  assert.deepEqual(plain(I.parseAsins("b0abcdefgh\nhttps://www.amazon.in/Mat/dp/B0ZZZZZZZ1/ref=sr_1 , B0ABCDEFGH junk 123")), ["B0ABCDEFGH", "B0ZZZZZZZ1"]);
  assert.deepEqual(plain(I.parseKeywords(" Yoga Mat \n\nyoga  mat\nanti slip mat, gym mat")), ["yoga mat", "anti slip mat", "gym mat"]);
});

test("index: keyword ideas from a listing", () => {
  const ideas: string[] = plain(I.suggestKeywords(I.listingText(doc("ext-product.html"), "B0SP000001"), 40));
  assert.equal(ideas[0], "boldfit", "brand first");
  assert.ok(ideas.includes("yoga mat 6mm") || ideas.includes("yoga mat"), "title phrases included");
  assert.ok(ideas.every((k) => !/^(the|for|with|and)\b|\b(the|for|with|and)$/.test(k)), "no phrases starting/ending with filler words");
  assert.ok(ideas.length <= 40);
});

test("index: indexed check and ranks across pages", () => {
  assert.equal(I.indexedIn(searchDoc(["B0X", "B0TARGET01"]), "B0TARGET01"), true);
  assert.equal(I.indexedIn(searchDoc(["B0X"]), "B0TARGET01"), false);
  const p1 = P.parseSearch(searchDoc(["S:B0SPONS001", "B0OTHER001", "B0OTHER002"]), 1).rows;
  const p2 = P.parseSearch(searchDoc(["S:B0TARGET01", "B0OTHER003", "B0TARGET01"]), 2).rows;
  const r = plain(I.ranksFrom([{ page: 1, rows: p1 }, { page: 2, rows: p2 }], ["B0TARGET01", "B0SPONS001", "B0MISSING1"]));
  assert.deepEqual(r.B0TARGET01, { organicRank: 4, organicPage: 2, sponsoredRank: 2, sponsoredPage: 2 });
  assert.deepEqual(r.B0SPONS001, { organicRank: null, organicPage: null, sponsoredRank: 1, sponsoredPage: 1 });
  assert.equal(r.B0MISSING1, undefined);
});

test("index: full run, stop part-way, resume skips finished cells", async () => {
  const A = "B0TARGET01";
  const B = "B0TARGET02";
  const calls: string[] = [];
  // "mat": both indexed, A organic #2 on p1, B sponsored #1 on p2. "rug": neither indexed.
  const fetchDoc = async (url: string) => {
    calls.push(url);
    const k = decodeURIComponent(new URL(url).searchParams.get("k")!);
    const page = Number(new URL(url).searchParams.get("page") || 1);
    if (k === `mat ${A}`) return searchDoc([A]);
    if (k === `mat ${B}`) return searchDoc(["B0X", B]);
    if (k.startsWith("rug ")) return searchDoc(["B0X"]);
    if (k === "mat") return page === 1 ? searchDoc(["B0X", A], true) : searchDoc([`S:${B}`]);
    throw new Error("unexpected " + url);
  };
  // First run stops after 2 searches; its finished cells stay in `prior`.
  const prior: Record<string, unknown> = {};
  const opts = { keywords: ["mat", "rug"], asins: [A, B], pages: 3, fetchDoc, prior };
  await assert.rejects(I.run({ ...opts, shouldStop: () => calls.length >= 2 }), (e: { stopped?: boolean }) => !!e.stopped);
  assert.equal(calls.length, 2);
  calls.length = 0;
  const progress: number[] = [];
  const done = plain(await I.run({ ...opts, shouldStop: () => false, onProgress: (d: number, t: number) => progress.push(t - d) }));
  assert.equal(calls.filter((u) => u.includes(encodeURIComponent(`mat ${A}`))).length, 0, "finished cells are not fetched again");
  assert.deepEqual(done.mat[A], { indexed: true, ranked: true, organicRank: 2, organicPage: 1, sponsoredRank: null, sponsoredPage: null });
  assert.deepEqual(done.mat[B], { indexed: true, ranked: true, organicRank: null, organicPage: null, sponsoredRank: 1, sponsoredPage: 2 });
  assert.equal(done.rug[A].indexed, false);
  assert.equal(done.rug[A].ranked, undefined, "no rank search for keywords nobody is indexed for");
  assert.equal(calls.filter((u) => /k=rug(&|$)/.test(u)).length, 0);
  assert.equal(progress[progress.length - 1], 0, "progress ends at 100%");
});

test("index: ranking organically overrides a negative ASIN search", async () => {
  const fetchDoc = async (url: string) => {
    const k = new URL(url).searchParams.get("k")!;
    if (k.includes("B0TARGET0")) return searchDoc([k.endsWith("1") ? "B0TARGET01" : "B0X"]);
    return searchDoc(["B0TARGET02", "B0TARGET01"]);
  };
  const r = plain(await I.run({ keywords: ["mat"], asins: ["B0TARGET01", "B0TARGET02"], pages: 1, fetchDoc }));
  assert.equal(r.mat.B0TARGET02.indexed, true);
  assert.equal(r.mat.B0TARGET02.indexedByRank, true);
  assert.equal(r.mat.B0TARGET02.organicRank, 1);
  assert.equal(r.mat.B0TARGET01.indexedByRank, undefined);
});

test("index: rank check off makes only index searches", async () => {
  const calls: string[] = [];
  const fetchDoc = async (url: string) => (calls.push(url), searchDoc(["B0TARGET01"]));
  const r = plain(await I.run({ keywords: ["a", "b"], asins: ["B0TARGET01"], pages: 0, fetchDoc }));
  assert.equal(calls.length, 2);
  assert.equal(r.a.B0TARGET01.indexed, true);
  assert.equal(r.a.B0TARGET01.ranked, undefined);
});

// ---------------------------------------------------------------- Product Track

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const T = (win as any).AxTrack;
const html = (s: string) => new win.DOMParser().parseFromString(`<html><head><title>x</title></head><body>${s}</body></html>`, "text/html");

const PAGE_BUYBOX = (seller: string, id: string, price: number, offers = 3) => html(`
  <span id="productTitle">Mat</span><a id="bylineInfo">Brand: Zen</a>
  <div id="corePriceDisplay_desktop_feature_div"><span class="a-price priceToPay"><span class="a-offscreen">₹${price}</span></span></div>
  <div id="availability">In stock</div>
  <div id="tabular-buybox"><div tabular-attribute-name="Ships from"><span class="tabular-buybox-text">Amazon</span></div>
  <div tabular-attribute-name="Sold by"><span class="tabular-buybox-text"><a id="sellerProfileTriggerId" href="/gp/x?seller=${id}">${seller}</a></span></div></div>
  <input id="add-to-cart-button"><div id="olpLinkWidget_feature_div">New (${offers}) from ₹${price - 10}</div>`);
const PAGE_NO_BUYBOX = html(`<span id="productTitle">Mat</span><div id="availability">Available from these sellers.</div>
  <div id="buybox-see-all-buying-choices"><a>See All Buying Options</a></div><div id="olpLinkWidget_feature_div">New (4) from ₹500</div>`);
const PAGE_UNAVAILABLE = html(`<span id="productTitle">Mat</span><div id="availability">Currently unavailable. We don't know when or if this item will be back in stock.</div>`);
const PAGE_GONE = new win.DOMParser().parseFromString("<html><head><title>Page Not Found</title></head><body></body></html>", "text/html");

test("product track: Buy Box states from the product page", () => {
  const a = plain(T.snapshot(PAGE_BUYBOX("Zen Official", "A1ZENSELLER01", 599), "B0A"));
  assert.equal(a.status, "buybox");
  assert.equal(a.buyboxSeller, "Zen Official");
  assert.equal(a.sellerId, "A1ZENSELLER01");
  assert.equal(a.fulfillment, "FBA");
  assert.equal(a.price, 599);
  assert.equal(a.otherOffers, 3);
  const b = plain(T.snapshot(PAGE_NO_BUYBOX, "B0B"));
  assert.equal(b.status, "no_buybox");
  assert.equal(b.buyboxSeller, null);
  assert.equal(b.price, null, "no Buy Box price when nobody holds it");
  assert.equal(b.otherOffers, 4);
  assert.equal(T.snapshot(PAGE_UNAVAILABLE, "B0C").status, "unavailable");
  assert.equal(T.snapshot(PAGE_GONE, "B0D").status, "not_found");
});

test("product track: you vs other seller, by name or seller ID", () => {
  const snap = plain(T.snapshot(PAGE_BUYBOX("Zen Official", "A1ZENSELLER01", 599), "B0A"));
  assert.equal(T.owner(snap, []), null, "no own sellers set");
  assert.equal(T.owner(snap, plain(T.parseOwn("zen  official"))), "you", "name match ignores case and spacing");
  assert.equal(T.owner(snap, plain(T.parseOwn("a1zenseller01"))), "you", "seller ID match");
  assert.equal(T.owner(snap, plain(T.parseOwn("Other Co, A9OTHERSELLER"))), "other");
  assert.equal(T.owner(plain(T.snapshot(PAGE_NO_BUYBOX, "B0B")), ["Zen Official"]), "none");
});

test("product track: changes since the last check", () => {
  const before = plain(T.snapshot(PAGE_BUYBOX("Zen Official", "A1ZENSELLER01", 600, 2), "B0A"));
  const lost = plain(T.snapshot(PAGE_BUYBOX("Cheap Deals", "A9CHEAPDEALS1", 540, 5), "B0A"));
  const texts = (c: { text: string }[]) => plain(c).map((x) => x.text);
  assert.deepEqual(texts(T.changes(before, lost)), ["Buy Box: Zen Official → Cheap Deals", "Price ₹600 → ₹540 (-10%)", "Offers 2 → 5"]);
  assert.deepEqual(texts(T.changes(before, plain(T.snapshot(PAGE_NO_BUYBOX, "B0A")))), ["Has Buy Box → No Buy Box", "Offers 2 → 4"]);
  assert.deepEqual(texts(T.changes(before, before)), []);
  assert.deepEqual(texts(T.changes(undefined, before)), [], "first check: nothing to compare");
});

test("product track: run, stop part-way, resume skips checked ASINs", async () => {
  const pages: Record<string, Document> = { B0A0000001: PAGE_BUYBOX("Zen Official", "A1ZENSELLER01", 599), B0A0000002: PAGE_NO_BUYBOX, B0A0000003: PAGE_GONE };
  const calls: string[] = [];
  const fetchDoc = async (url: string) => {
    calls.push(url);
    return pages[url.match(/\/dp\/([A-Z0-9]{10})/)![1]];
  };
  const results: Record<string, { status: string }> = {};
  const asins = Object.keys(pages);
  await assert.rejects(T.run({ asins, fetchDoc, results, shouldStop: () => calls.length >= 1 }), (e: { stopped?: boolean }) => !!e.stopped);
  assert.deepEqual(Object.keys(results), ["B0A0000001"]);
  const progress: [number, number][] = [];
  await T.run({ asins, fetchDoc, results, onProgress: (d: number, t: number) => progress.push([d, t]) });
  assert.equal(calls.length, 3, "the first ASIN wasn't fetched again");
  assert.deepEqual(asins.map((a) => results[a].status), ["buybox", "no_buybox", "not_found"]);
  assert.deepEqual(plain(progress[progress.length - 1]), [3, 3]);
});

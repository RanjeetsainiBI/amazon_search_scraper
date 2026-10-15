# Microsoft Edge Add-ons: submission kit

Everything to paste into Partner Center, field by field. Images are in [`store/images/`](images/). The upload package comes from the [GitHub release](https://github.com/RanjeetsainiBI/amazon_search_scraper/releases) (`adlytics-xray-<version>.zip`).

---

## 1. Availability

- **Visibility:** **Hidden** = only people with the link can install it (recommended for a team tool). **Public** = anyone can find it in the store.
- **Markets:** All markets, or just India.

## 2. Properties

- **Category:** Productivity
- **Privacy policy:** Yes, this extension needs one. URL:
  `https://github.com/RanjeetsainiBI/amazon_search_scraper/blob/main/PRIVACY.md`
- **Website URL:** `https://github.com/RanjeetsainiBI/amazon_search_scraper`
- **Support contact:** `https://github.com/RanjeetsainiBI/amazon_search_scraper/issues`
- **Mature content:** No

## 3. Store listing (English)

**Display name** (comes from the package):
AdLytics Xray - Seller Research for Amazon.in

**Short description** (the store may fill this from the manifest; edit if asked):
Scan amazon.in search pages, storefronts and products: organic & sponsored rank, Buy Box, BSR, manufacturer, seller details. CSV.

**Description:**

```
AdLytics Xray turns any amazon.in search results page, seller storefront or product page into a sortable research table, in one click.

⚡ QUICK SCAN: instant
• Page, position, organic rank and sponsored (SP) rank, counted across up to 10 result pages
• ASIN, title, brand, image
• Price, MRP and discount %
• Rating, review count, "bought in past month", badges, Prime

🔎 DEEP SCAN: opens every product and seller page for you
• Buy Box seller, seller ID, FBA / FBM / Amazon fulfilment, number of other offers
• Best Sellers Rank with category and sub-category ranks
• Manufacturer, packer and importer details, country of origin
• Image count, A+ content, video, bullet count, date first available
• Seller account name, registered business name and business address (city, state, PIN code), seller rating

📊 BUILT FOR RESEARCH
• Summary strip: listings, organic vs sponsored, average price and rating, total reviews, brands, sellers, % FBA
• Sort by any column, filter by text, switch between All / Organic / Sponsored
• Export exactly what you see to CSV (Excel-ready, with product and seller links)
• Results are remembered for 3 days, so repeat scans are instant

🔒 PRIVATE BY DESIGN
• Runs entirely in your browser with your own amazon.in session
• No account, no servers, no analytics: nothing is sent anywhere except amazon.in
• Deep scans go at a human pace (3–7 seconds per page, adjustable) and pause if Amazon shows a captcha

WHO IT'S FOR
Amazon sellers, brand owners, agencies and PPC managers researching competitors, keyword placements, sponsored share of voice and potential partners on amazon.in.

HOW TO USE
1. Open an amazon.in search, a seller storefront (amazon.in/s?me=…) or a product page
2. Click the Xray button (bottom right) or the toolbar icon
3. Choose pages, then Quick scan or Deep scan
4. Sort, filter, export CSV

AdLytics Xray isn't affiliated with, endorsed by or sponsored by Amazon. Amazon and amazon.in are trademarks of Amazon.com, Inc. or its affiliates.
```

**Search terms** (up to 7, each 30 characters or fewer, 21 words in total):
- amazon india research
- amazon seller research
- amazon product research
- sponsored rank checker
- bsr checker
- amazon competitor analysis
- seller details amazon

**Images:**

| Field | File | Size |
|---|---|---|
| Extension logo (required) | `images/logo-300.png` | 300×300 |
| Small promotional tile | `images/promo-small-440x280.png` | 440×280 |
| Large promotional tile | `images/promo-large-1400x560.png` | 1400×560 |
| Screenshots (up to 6) | `images/screenshot-1-quick.png` … `screenshot-4-product.png` | 1280×800 |

**YouTube video:** leave empty.

## 4. Notes for certification

Paste into "Notes for certification" so the reviewer can test without guessing:

```
No account or login is needed.
To test:
1. Open https://www.amazon.in/s?k=yoga+mat
2. Click the "Xray" button at the bottom-right of the page (or the toolbar icon).
3. Click "Quick scan": the table fills with the listings on the page, with organic and sponsored rank.
4. Click "Deep scan": the extension fetches each product page and seller profile from amazon.in at 3–7 s per page and adds Buy Box, BSR, manufacturer and seller business details. A full page takes a few minutes; press Stop at any time.
5. Click "CSV" to export.
It also works on product pages (amazon.in/dp/...) and seller storefronts (amazon.in/s?me=...).

Permissions: host access to www.amazon.in only (reading the scanned pages and fetching product/seller pages); storage (settings and a 3-day local cache); scripting (to open the panel on amazon.in tabs that were already open at install time).
No remote code, no analytics, no data leaves the browser except requests to amazon.in.
```

---

## Releasing an update later

1. Bump `"version"` in `extension/manifest.json` (e.g. 1.0.0 → 1.0.1).
2. Push a tag `xray-v1.0.1`. GitHub Actions builds `adlytics-xray-1.0.1.zip` on the Releases page.
3. Partner Center → your extension → **Update** → upload the new zip → **Publish**.
4. After certification (usually 1–3 days for updates), every installed copy updates itself.

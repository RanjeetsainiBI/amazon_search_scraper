# AdLytics Xray: Chrome extension for amazon.in

It works like Helium 10 Xray, but for **amazon.in**. Open a search results page, a seller storefront (`/s?me=…`) or a product page, click **Xray**, and get a table you can sort, filter and export to CSV.

| | ⚡ **Quick scan** | 🔎 **Deep scan** |
|---|---|---|
| Speed | instant (plus about 5 s for each extra page) | 3–7 s per product and seller page |
| Reads | the result pages | + every product page + every seller profile |
| Position | page, position on page, **organic rank**, **sponsored (SP) rank**, counted across all pages scanned | same |
| Listing | ASIN, title, brand, image, price, MRP, discount %, rating, reviews, "bought in past month", badges, Prime | same |
| Product page | | **Buy Box seller**, seller ID, FBA / FBM / Amazon, other offers, availability, **BSR + category + sub-category ranks**, **manufacturer, packer, importer**, country of origin, first available date, image count, **A+**, **video**, bullet count |
| Seller profile (tick "Seller info") | | **account name, business name, business address**, city, state, PIN code, seller rating, ratings count |

On a product page, Quick scan reads that page and Deep scan adds its seller's business details.

Deep scan uses **your own amazon.in session**: the same browser, sign-in and connection you shop with. That means far fewer captchas than a server, and nothing goes to any outside service. Results are kept for 3 days, so a second scan of the same products is instant.

## Three tools, one click

Click the **AdLytics Xray** toolbar icon to see three options:

| Option | What it does |
|---|---|
| ⬇ **Download Result** | Opens the Xray panel on the amazon.in search, storefront or product page you're on: Quick or Deep scan, then CSV. (The **Xray** button at the bottom-right of those pages does the same.) |
| 📈 **Rank Track** | Keyword index check plus organic and sponsored rank for up to 10 ASINs (details below). |
| 🛒 **Product Track** | Paste or upload hundreds of ASINs and see who holds the Buy Box on each, at what price, and what changed since the last check (details below). |

## 🛒 Product Track

- **Input:** paste up to **1,000 ASINs** or product links, or **upload a CSV/TXT** (any file containing ASINs, such as an inventory or business report export). Duplicates are removed.
- **Your sellers (optional):** your seller names or seller IDs. Every ASIN then shows **You** or **Other seller**, so lost Buy Boxes stand out.
- **Per ASIN:** status (**Has Buy Box**, **No Buy Box** (offers exist but nobody holds it), **Unavailable**, **Not found** (listing removed or suppressed)), Buy Box seller with a link to the seller profile, seller ID, FBA / FBM / Amazon, Buy Box price, MRP, number of offers, availability, title, brand, rating, reviews, BSR.
- **Change since last check:** each ASIN is compared with the last time you checked it: Buy Box seller changes, status changes, price changes (with %), and new offers.
- **Summary tiles:** click a tile (Lost to others, No Buy Box, Changed, …) to filter the table. **CSV** exports the current view.
- **Stop / Resume:** checked ASINs are kept, so a captcha or closed tab costs nothing.
- **Time:** about 5 s per ASIN, so 100 ASINs take about 8–10 minutes and 500 take about 45 minutes.

Run it on Monday morning for your catalogue, or for a client's, to catch hijackers, suppressed listings and Buy Box losses before they cost a week of sales.

## 📈 Rank Track (Index Checker)

Find out which keywords Amazon has **indexed** for your ASINs, meaning the keyword can bring the product up in search, and where each one ranks.

- **Open it:** toolbar icon → **Rank Track**, or the **📈 Rank Track** button in the Xray panel. On a product page, the ASIN fills in automatically.
- **Input:** up to 10 ASINs (or product links) and up to 200 keywords. **＋ Suggest from listing** reads the first ASIN's title, bullets and brand and adds keyword ideas.
- **How it checks:** it searches amazon.in for `keyword + ASIN`. If the ASIN comes back, it's **indexed**. For indexed keywords it then searches the plain keyword (pages 1–3, adjustable) and records the **organic rank** and **sponsored rank**. Ranking organically also counts as indexed.
- **Output:** a keyword × ASIN grid, an indexed % per ASIN, an "on page 1" count, a **Not indexed** filter, **⧉ Copy not-indexed** (paste straight into backend search terms) and a CSV export.
- **Stop / Resume:** finished checks are saved, so a captcha or a closed tab costs nothing. Resume picks up where it stopped.
- **Time:** about 5 s per search. 50 keywords × 1 ASIN with a 3-page rank check takes about 4–15 minutes, depending on how many keywords are indexed.

Use it to check a new listing went live with its keywords, to see whether a keyword you advertise on can serve organically, and to find indexing gaps across a set of variations or competitors.

## Install

**From Microsoft Edge Add-ons** (one click, updates itself): use the store link once the listing is live.

**Manual install** (Chrome, Edge, Brave), about 2 minutes:

1. Download `adlytics-xray-<version>.zip` from [Releases](https://github.com/RanjeetsainiBI/amazon_search_scraper/releases) and unzip it. Or clone the repo and use its `extension` folder.
2. Open `chrome://extensions` in Chrome (Edge and Brave work too).
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the unzipped folder.
5. Pin **AdLytics Xray** from the puzzle-piece menu.
6. Click the toolbar icon and choose **Download Result**, **Rank Track** or **Product Track**.

To update: replace the folder with the new version and click **↻ Reload** on the extension card.

## Using it

- **Pages:** how many result pages to scan, starting from the one you're on. Organic and SP ranks keep counting across pages, so start from page 1 for true ranks.
- **Seller info:** untick it to skip seller profiles. Deep scan then takes about half as long.
- **Filter box and the All / Organic / Sponsored switch:** these narrow the table, and **CSV exports exactly what you see**.
- **Click a column header** to sort, for example by Reviews to find the category leaders, or by BSR.
- **⚙ Settings:** change the pace (seconds between pages) or clear the saved results.
- **Captcha:** the scan pauses and tells you. Open any amazon.in page in a new tab, solve it, then press Deep scan again. Finished rows come from the saved results, so nothing is fetched twice.

**About time:** a 48-listing page with seller info takes roughly 48 product pages plus one page per unique seller, at about 5 s each: **5–7 minutes** the first time and seconds after that. Leave the tab open while it runs. Other tabs are fine.

## Publishing

The Edge Add-ons listing text, images and certification notes are in [`store/edge-listing.md`](../store/edge-listing.md). The privacy policy is [`PRIVACY.md`](../PRIVACY.md).

## Notes

- Amazon changes its layout from time to time. All page reading is in [`parse.js`](parse.js), and every field has fallbacks. If a column comes back empty everywhere, save the page (Ctrl+S) and add it as a test fixture (see the main README).
- Automated collection is against Amazon's Conditions of Use. Keep the default pace and scan what you actually need.

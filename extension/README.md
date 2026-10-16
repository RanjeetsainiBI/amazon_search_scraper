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

## 🔑 Index Checker

Find out which keywords Amazon has **indexed** for your ASINs, meaning the keyword can bring the product up in search, and where each one ranks.

- **Open it:** the **🔑 Index Checker** button in the Xray panel (on a product page the ASIN fills in automatically), or click the toolbar icon on any non-Amazon tab.
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
6. Open any amazon.in search page and click the **Xray** button (bottom right) or the toolbar icon.

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

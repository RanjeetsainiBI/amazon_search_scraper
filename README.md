# amazon_search_scraper

Two ways to collect amazon.in data:

- **[Chrome extension: AdLytics Xray](extension/README.md)**: click-to-scan panel on search results, seller storefronts and product pages. You get organic and SP rank, Buy Box, seller, BSR, manufacturer, business name and address, and a CSV export. **Start here.**
- **Command-line scraper** (below): unattended keyword runs that produce a seller lead list.

---

## Command-line scraper

Turns **amazon.in search results** into a **seller lead list (CSV)**. You give it keywords. For every product it finds the third-party seller, then reads:

- the seller's **business name and registered address** from "Detailed Seller Information" on their seller profile
- the product's **manufacturer, packer and importer** details (Indian listings are required to show these), plus brand and country of origin
- price, rating, review count, Best Sellers Rank, and whether the listing is **Sponsored**

You get one row per seller, ready to enrich (Apollo, LinkedIn, the company's website) and use for outreach.

It runs on your own laptop: Amazon blocks cloud and datacenter IPs, but a home or office connection works.

## Setup (once)

You need [Node.js 20+](https://nodejs.org).

```bash
git clone https://github.com/RanjeetsainiBI/amazon_search_scraper.git
cd amazon_search_scraper
npm run setup        # installs packages + the Chromium browser
```

## Run

```bash
# Quick start: visible browser, so you can solve a captcha if one appears
npm run scrape -- --keywords "yoga mat, resistance band" --pages 3 --headful

# Many keywords from a file
npm run scrape -- --keywords-file keywords.example.txt --pages 5 --headful

# Only sellers already paying for ads, products with 50-5,000 reviews
npm run scrape -- -k "protein shaker" --sponsored-only --min-reviews 50 --max-reviews 5000 --headful
```

Results land in `output/`:

| File | One row per | Key columns |
|---|---|---|
| `leads.csv` | **seller** | business_name, business_address, city, state, pincode, brands, manufacturers, importers, products_found, sponsored_products, total_reviews, seller_profile_url, storefront_url |
| `products.csv` | product | keyword, position, sponsored, asin, title, brand, price, rating, reviews, seller, manufacturer, packer, importer, BSR |

`leads.csv` lists the busiest sellers first (most products in your keywords, then most reviews).

### Resume, stop, captchas

- Progress is saved after every page. **Run the same command again to pick up where it stopped.** Pages already done are not reloaded. Use `--fresh` to start over.
- **Ctrl+C** stops cleanly after the current page.
- With `--headful`, a captcha pauses the run for up to 5 minutes so you can solve it in the window, then it continues by itself. Without it, the run saves and stops. Wait 15–30 minutes, then run again.
- `--chrome` uses your installed Google Chrome, which Amazon tends to trust more than Playwright's Chromium.
- The browser profile (cookies) is kept in `output/browser-profile`, so Amazon sees a returning visitor rather than a new one every run.

### All options

```
-k, --keywords <list>     comma-separated keywords
-f, --keywords-file <p>   one keyword per line
-p, --pages <n>           search pages per keyword (default 3, ~20 products each)
-o, --out <dir>           output folder (default ./output)
    --headful             show the browser (recommended)
    --chrome              use installed Google Chrome
    --min-delay / --max-delay <s>   pause between pages (default 4-9 s)
    --max-products <n>    stop after n new products this run
    --min-reviews / --max-reviews <n>
    --min-price / --max-price <inr>
    --max-rating <x>      e.g. 4.0: listings that need help
    --sponsored-only      only Sponsored results
    --include-amazon      keep Amazon retail / Cloudtail / Appario (skipped by default)
    --fresh               ignore saved progress
```

## Speed

At the default pace (4–9 s between pages, which keeps captchas rare), expect **about 350–400 pages an hour**. Each new seller costs about 2 pages (product + seller profile), and later products from the same seller cost 1. In practice that's roughly **150–250 unique sellers an hour**. Filters are checked on the search card, so a skipped product costs nothing.

## What it can't give you

Amazon doesn't show seller **emails or phone numbers**. You get the legal business name, address, brand and manufacturer or importer entities. Use those as the key for enrichment (Apollo, Lusha, LinkedIn, the brand's website or GST lookups) to find a decision-maker.

## Use it responsibly

- Automated access is against Amazon's Conditions of Use. Keep the default pace and run volumes your business actually needs. You're responsible for how you use this tool.
- Only public business information is collected. Scraped data stays in `output/`, which is git-ignored. **Never commit lead data to this public repo.**
- For outreach, follow the laws that apply to you, for example India's DPDP Act 2023. For UK/EU or US recipients, GDPR and CAN-SPAM also apply. Identify yourself, keep it relevant to the business, and honour opt-outs.

## When Amazon changes its layout

All the page parsing is in [`src/parse.ts`](src/parse.ts), and every parser falls back to older selectors. If a column comes back empty for everything:

1. Save the page: run with `--headful`, open the product, Ctrl+S.
2. Add it under `test/fixtures/`, add an assertion in `test/parse.test.ts`, and fix the selector.
3. Run `npm test`.

## Development

```bash
npm test            # CLI + extension parser tests against fixtures (offline, jsdom)
npm run typecheck

# End-to-end run against a local fake amazon.in (no internet needed)
node test/mock-server.mjs &
AMAZON_BASE_URL=http://localhost:4599 npm run scrape -- -k "yoga mat" -o /tmp/e2e --min-delay 0.1 --max-delay 0.2
```

Layout: `src/cli.ts` (run loop, resume), `src/browser.ts` (paced browser, captcha handling), `src/parse.ts` (HTML → data), `src/leads.ts` (filters, seller roll-up, CSV columns), `src/state.ts` (saved progress), `src/csv.ts`.

## License

MIT

# Privacy Policy: AdLytics Xray

_Last updated: 16 October 2026_

AdLytics Xray ("the extension") is a browser extension that helps you research product listings and sellers on amazon.in. This policy explains what the extension does with data.

## The short version

**Nothing leaves your browser.** The extension has no servers and no analytics. It doesn't collect, sell or share any data. There is no account and no sign-in.

## What the extension reads

When you click **Quick scan** or **Deep scan** on an amazon.in page, the extension reads publicly visible information from:

- the amazon.in page you are on (search results, a seller storefront or a product page),
- for the Index Checker, the amazon.in search results for the keywords and ASINs you enter (and, for keyword ideas, that ASIN's product page), and
- for a deep scan, the public product pages and seller profile pages of the listings shown. These are fetched from amazon.in in your own browser.

This includes product titles, prices, ratings, review counts, rankings, the Buy Box seller, product details (such as manufacturer, packer and importer), and the business name and address that sellers publish on their amazon.in seller profile.

The extension does **not** read your Amazon account details, orders, addresses, payment information, browsing history, or any website other than amazon.in.

## Where data is stored

- **Scan results** are cached in your browser's local extension storage (`chrome.storage.local`) for up to 3 days so repeat scans are faster. You can delete them at any time with **⚙ Settings → Clear saved results**, or by removing the extension.
- **Index Checker** keeps the ASINs, keywords and results of your last check in local extension storage so they're still there after a reload. Starting a new check or removing the extension deletes them.
- **Your settings** (pages to scan, pace, the "Seller info" toggle) are saved in browser extension storage (`chrome.storage.sync`). If browser sync is on, your browser may sync these settings between your own devices.
- **CSV exports** are saved to your computer only when you click **CSV**.

## What is sent where

- Requests go **only to amazon.in**, the same requests your browser makes when you open those pages yourself.
- No data is sent to the developer or to any third party.
- No advertising, tracking or analytics code is included, and no code is loaded from outside the extension.

## Permissions and why they're needed

| Permission | Why |
|---|---|
| Access to `www.amazon.in` | To read the page you scan and to fetch the product and seller pages for a deep scan |
| `storage` | To keep your settings and the 3-day cache of scan results in your browser |
| `scripting` | To open the panel on amazon.in tabs that were already open before the extension was installed |

## Children

The extension is a business research tool and isn't directed at children.

## Changes

If this policy changes, the new version will be published at this address with a new "Last updated" date.

## Contact

Questions? Open an issue at <https://github.com/RanjeetsainiBI/amazon_search_scraper/issues>.

_AdLytics Xray isn't affiliated with, endorsed by or sponsored by Amazon. Amazon and amazon.in are trademarks of Amazon.com, Inc. or its affiliates._

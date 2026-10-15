import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runScrape } from "./scraper.ts";

const HELP = `
amazon_search_scraper: amazon.in search results -> seller lead list (CSV)

Usage:
  npm run scrape -- --keywords "yoga mat, resistance band" [options]
  npm run scrape -- --keywords-file keywords.txt [options]

Options:
  -k, --keywords <list>     Comma-separated search keywords
  -f, --keywords-file <p>   Text file, one keyword per line (# for comments)
  -p, --pages <n>           Search pages per keyword (default 3, about 20 products each)
  -o, --out <dir>           Output folder (default ./output)
      --headful             Show the browser; you can solve captchas yourself (recommended)
      --chrome              Use your installed Google Chrome instead of Playwright's Chromium
      --min-delay <s>       Minimum seconds between pages (default 4)
      --max-delay <s>       Maximum seconds between pages (default 9)
      --max-products <n>    Stop after this many new products in this run

  Filters (checked on the search card, before the product page is opened):
      --min-reviews <n>     --max-reviews <n>
      --min-price <inr>     --max-price <inr>
      --max-rating <x>      e.g. 4.0 to find listings that need help
      --sponsored-only      Only products shown as Sponsored (sellers already spending on ads)
      --include-amazon      Keep Amazon retail / Cloudtail / Appario (skipped by default)

      --fresh               Ignore saved progress and start over
  -h, --help

Output:
  <out>/leads.csv     one row per seller: business name, address, brands, manufacturers...
  <out>/products.csv  one row per product
  Progress is saved after every page; run the same command again to resume.
`;

const { values: a } = parseArgs({
  options: {
    keywords: { type: "string", short: "k" },
    "keywords-file": { type: "string", short: "f" },
    pages: { type: "string", short: "p", default: "3" },
    out: { type: "string", short: "o", default: "output" },
    headful: { type: "boolean", default: false },
    chrome: { type: "boolean", default: false },
    "min-delay": { type: "string", default: "4" },
    "max-delay": { type: "string", default: "9" },
    "max-products": { type: "string" },
    "min-reviews": { type: "string" },
    "max-reviews": { type: "string" },
    "min-price": { type: "string" },
    "max-price": { type: "string" },
    "max-rating": { type: "string" },
    "sponsored-only": { type: "boolean", default: false },
    "include-amazon": { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const optNum = (v: string | undefined) => (v === undefined ? undefined : Number(v));

function keywords(): string[] {
  const list: string[] = [];
  if (a.keywords) list.push(...a.keywords.split(","));
  if (a["keywords-file"]) list.push(...readFileSync(a["keywords-file"], "utf8").split(/\r?\n/).filter((l) => !l.trim().startsWith("#")));
  return [...new Set(list.map((k) => k.trim()).filter(Boolean))];
}

async function main() {
  const kws = keywords();
  if (a.help || !kws.length) {
    console.log(HELP);
    process.exit(a.help ? 0 : 1);
  }
  const outDir = resolve(a.out!);

  let stop = false;
  process.on("SIGINT", () => {
    if (stop) process.exit(130);
    stop = true;
    console.log("\nStopping after this page (Ctrl+C again to quit now)...");
  });

  const { outcome } = await runScrape(
    {
      keywords: kws,
      pages: Math.max(1, Number(a.pages)),
      outDir,
      profileDir: join(outDir, "browser-profile"),
      headful: a.headful!,
      chrome: a.chrome!,
      minDelaySec: Number(a["min-delay"]),
      maxDelaySec: Number(a["max-delay"]),
      maxProducts: optNum(a["max-products"]),
      filters: {
        minReviews: optNum(a["min-reviews"]),
        maxReviews: optNum(a["max-reviews"]),
        minPrice: optNum(a["min-price"]),
        maxPrice: optNum(a["max-price"]),
        maxRating: optNum(a["max-rating"]),
        sponsoredOnly: a["sponsored-only"],
      },
      includeAmazon: a["include-amazon"]!,
      fresh: a.fresh,
    },
    { shouldStop: () => stop },
  );
  console.log(`→ ${join(outDir, "leads.csv")}\n→ ${join(outDir, "products.csv")}`);
  process.exit(outcome === "captcha" ? 2 : outcome === "error" ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

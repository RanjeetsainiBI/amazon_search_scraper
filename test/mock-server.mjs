// Serves the fixtures as a fake amazon.in for an end-to-end run: AMAZON_BASE_URL=http://localhost:4599
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8");
createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  let body = "<html><title>Page Not Found</title></html>";
  if (u.pathname === "/s") body = u.searchParams.get("page") === "2" ? fx("search-last.html") : fx("search.html");
  else if (u.pathname.startsWith("/dp/B0AAAAAAA1")) body = fx("product.html");
  else if (u.pathname.startsWith("/dp/B0BBBBBBB2")) body = fx("product-table.html");
  else if (u.pathname === "/sp") body = fx("seller.html");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
}).listen(Number(process.env.PORT ?? 4599));

import { exec } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { toLine } from "./csv.ts";
import { buildLeads, LEAD_HEADER, type Filters, type ProductRow } from "./leads.ts";
import type { SellerInfo } from "./parse.ts";
import { runScrape, type Progress, type ScrapeOutcome } from "./scraper.ts";
import { loadState } from "./state.ts";

/**
 * Web interface for the scraper. Your laptop is the server: open
 * http://localhost:3000 on it, or from another device on the same network when
 * started with HOST=0.0.0.0 and APP_PASSWORD set. Runs are queued and go one at
 * a time (one browser, one IP), each in its own folder under output/jobs/.
 */

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "127.0.0.1";
const PASSWORD = process.env.APP_PASSWORD ?? "";
const DATA = resolve(process.env.DATA_DIR ?? "output");
const JOBS = join(DATA, "jobs");
const PUBLIC = resolve(import.meta.dirname, "../public");
const LOCAL = HOST === "127.0.0.1" || HOST === "localhost" || HOST === "::1";

if (!LOCAL && !PASSWORD) {
  console.error(`Refusing to listen on ${HOST} without a password: anyone on the network could use it.\nSet APP_PASSWORD, e.g.  APP_PASSWORD=choose-something HOST=0.0.0.0 npm start`);
  process.exit(1);
}

// ------------------------------------------------------------------ jobs

type Status = "queued" | "running" | ScrapeOutcome;

interface JobParams {
  keywords: string[];
  pages: number;
  headful: boolean;
  chrome: boolean;
  minDelaySec: number;
  maxDelaySec: number;
  maxProducts?: number;
  filters: Filters;
  includeAmazon: boolean;
}

interface Job {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: Status;
  params: JobParams;
  progress: Progress | null;
  error?: string;
  captchaWaiting?: boolean;
}

const jobs = new Map<string, Job>();
const logs = new Map<string, string[]>();
const queue: string[] = [];
let running: string | null = null;
let stopRequested = false;

const jobDir = (id: string) => join(JOBS, id);
const saveJob = (j: Job) => {
  j.updatedAt = new Date().toISOString();
  writeFileSync(join(jobDir(j.id), "job.json"), JSON.stringify(j, null, 2));
};

function loadJobs() {
  mkdirSync(JOBS, { recursive: true });
  for (const id of readdirSync(JOBS)) {
    const f = join(JOBS, id, "job.json");
    if (!existsSync(f)) continue;
    const j: Job = JSON.parse(readFileSync(f, "utf8"));
    // The server stopped while these were going; their progress is saved, so they can be resumed.
    if (j.status === "running" || j.status === "queued") {
      j.status = "stopped";
      j.captchaWaiting = false;
      saveJob(j);
    }
    jobs.set(id, j);
    const logFile = join(JOBS, id, "log.txt");
    logs.set(id, existsSync(logFile) ? readFileSync(logFile, "utf8").split("\n").filter(Boolean).slice(-300) : []);
  }
}

function addLog(id: string, line: string) {
  const list = logs.get(id) ?? [];
  const stamped = `${new Date().toLocaleTimeString("en-IN", { hour12: false })}  ${line.trim()}`;
  list.push(stamped);
  if (list.length > 300) list.shift();
  logs.set(id, list);
  appendFileSync(join(jobDir(id), "log.txt"), stamped + "\n");
  broadcast({ type: "log", id, line: stamped });
}

function update(j: Job, patch: Partial<Job>) {
  Object.assign(j, patch);
  saveJob(j);
  broadcast({ type: "job", job: j });
}

function enqueue(j: Job) {
  if (running === j.id || queue.includes(j.id)) return;
  queue.push(j.id);
  update(j, { status: "queued", error: undefined });
  void pump();
}

async function pump() {
  if (running) return;
  const id = queue.shift();
  if (!id) return;
  const j = jobs.get(id);
  if (!j) return pump();
  running = id;
  stopRequested = false;
  update(j, { status: "running" });
  try {
    const res = await runScrape(
      { ...j.params, outDir: jobDir(id), profileDir: join(DATA, "browser-profile") },
      {
        log: (l) => l.trim() && addLog(id, l),
        progress: (p) => update(j, { progress: p }),
        captcha: (waiting) => update(j, { captchaWaiting: waiting }),
        shouldStop: () => stopRequested,
      },
    );
    update(j, { status: res.outcome, error: res.error, progress: res.progress, captchaWaiting: false });
  } catch (e) {
    update(j, { status: "error", error: e instanceof Error ? e.message : String(e), captchaWaiting: false });
  } finally {
    running = null;
    void pump();
  }
}

function createJob(body: Record<string, unknown>): Job {
  const n = (v: unknown) => (v === "" || v === null || v === undefined || Number.isNaN(Number(v)) ? undefined : Number(v));
  const keywords = [...new Set(String(body.keywords ?? "").split(/[\n,]+/).map((k) => k.trim()).filter(Boolean))].slice(0, 200);
  if (!keywords.length) throw new Error("Add at least one keyword.");
  const id = `${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;
  const params: JobParams = {
    keywords,
    pages: Math.min(20, Math.max(1, n(body.pages) ?? 3)),
    headful: body.headful !== false,
    chrome: body.chrome === true,
    minDelaySec: Math.max(1, n(body.minDelaySec) ?? 4),
    maxDelaySec: Math.max(1, n(body.maxDelaySec) ?? 9),
    maxProducts: n(body.maxProducts),
    filters: {
      minReviews: n(body.minReviews),
      maxReviews: n(body.maxReviews),
      minPrice: n(body.minPrice),
      maxPrice: n(body.maxPrice),
      maxRating: n(body.maxRating),
      sponsoredOnly: body.sponsoredOnly === true,
    },
    includeAmazon: body.includeAmazon === true,
  };
  const name = String(body.name ?? "").trim().slice(0, 80) || (keywords.length > 1 ? `${keywords[0]} +${keywords.length - 1}` : keywords[0]);
  const now = new Date().toISOString();
  const j: Job = { id, name, createdAt: now, updatedAt: now, status: "queued", params, progress: null };
  mkdirSync(jobDir(id), { recursive: true });
  jobs.set(id, j);
  logs.set(id, []);
  saveJob(j);
  return j;
}

/** Products and sellers from one job, or from every job merged (first one found wins). */
function collect(ids: string[]) {
  const products: Record<string, ProductRow> = {};
  const sellers: Record<string, SellerInfo> = {};
  for (const id of ids) {
    const s = loadState(join(jobDir(id), "state.json"));
    for (const [k, v] of Object.entries(s.products)) products[k] ??= v;
    for (const [k, v] of Object.entries(s.sellers)) sellers[k] ??= v;
  }
  return buildLeads(Object.values(products), sellers);
}

// ------------------------------------------------------------------ live updates (server-sent events)

const clients = new Set<ServerResponse>();
function broadcast(msg: unknown) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const c of clients) c.write(data);
}
setInterval(() => {
  for (const c of clients) c.write(": ping\n\n");
}, 25_000).unref();

// ------------------------------------------------------------------ http

function authorized(req: IncomingMessage): boolean {
  if (!PASSWORD) return true;
  const m = (req.headers.authorization ?? "").match(/^Basic (.+)$/);
  if (!m) return false;
  const pass = Buffer.from(m[1], "base64").toString().split(":").slice(1).join(":");
  const a = Buffer.from(pass);
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" }).end(JSON.stringify(body));
};

const csv = (res: ServerResponse, filename: string, content: string) => {
  res.writeHead(200, { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${filename}"` }).end(content);
};

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw new Error("Request too large");
  }
  return raw ? JSON.parse(raw) : {};
}

const publicJob = (j: Job) => ({ ...j, running: running === j.id, queuePosition: queue.indexOf(j.id) + 1 || null });
const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 40) || "leads";

async function handle(req: IncomingMessage, res: ServerResponse) {
  if (!authorized(req)) {
    res.writeHead(401, { "www-authenticate": 'Basic realm="Amazon Search Scraper"' }).end("Password required");
    return;
  }
  const url = new URL(req.url ?? "/", "http://x");
  const path = url.pathname;
  const method = req.method ?? "GET";

  // Blocks other websites open in your browser from starting or deleting runs.
  if (method !== "GET") {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { error: "Cross-site request blocked" });
  }

  if (method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(readFileSync(join(PUBLIC, "index.html")));
    return;
  }
  if (method === "GET" && path === "/api/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ type: "hello" })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (method === "GET" && path === "/api/jobs") {
    return json(res, 200, [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob));
  }
  if (method === "POST" && path === "/api/jobs") {
    try {
      const j = createJob(await readBody(req));
      enqueue(j);
      return json(res, 201, publicJob(j));
    } catch (e) {
      return json(res, 400, { error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (method === "GET" && path === "/api/leads.csv") {
    const rows = collect([...jobs.keys()]);
    return csv(res, `all-leads-${new Date().toISOString().slice(0, 10)}.csv`, "﻿" + toLine(LEAD_HEADER) + rows.map(toLine).join(""));
  }

  const m = path.match(/^\/api\/jobs\/([a-z0-9-]+)(?:\/([a-z.]+))?$/);
  const j = m ? jobs.get(m[1]) : undefined;
  if (!m || !j) return json(res, 404, { error: "Not found" });
  const action = m[2];

  if (method === "GET" && !action) return json(res, 200, { ...publicJob(j), log: logs.get(j.id) ?? [] });
  if (method === "GET" && action === "leads") {
    const rows = collect([j.id]);
    return json(res, 200, { header: LEAD_HEADER, rows: rows.slice(0, 500), total: rows.length });
  }
  if (method === "GET" && (action === "leads.csv" || action === "products.csv")) {
    const f = join(jobDir(j.id), action);
    if (!existsSync(f)) return json(res, 404, { error: "No results yet" });
    return csv(res, `${safeName(j.name)}-${action}`, readFileSync(f, "utf8"));
  }
  if (method === "POST" && action === "stop") {
    const qi = queue.indexOf(j.id);
    if (qi >= 0) {
      queue.splice(qi, 1);
      update(j, { status: "stopped" });
    } else if (running === j.id) {
      stopRequested = true;
      addLog(j.id, "Stop requested: finishing the current page…");
    }
    return json(res, 200, publicJob(j));
  }
  if (method === "POST" && action === "resume") {
    enqueue(j);
    return json(res, 200, publicJob(j));
  }
  if (method === "DELETE" && !action) {
    if (running === j.id) return json(res, 409, { error: "Stop the run before deleting it." });
    const qi = queue.indexOf(j.id);
    if (qi >= 0) queue.splice(qi, 1);
    jobs.delete(j.id);
    logs.delete(j.id);
    rmSync(jobDir(j.id), { recursive: true, force: true });
    broadcast({ type: "deleted", id: j.id });
    return json(res, 200, { ok: true });
  }
  return json(res, 404, { error: "Not found" });
}

loadJobs();
createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: "Server error" });
  });
}).listen(PORT, HOST, () => {
  const local = `http://localhost:${PORT}`;
  console.log(`\nAmazon Search Scraper is running.\n  On this laptop:   ${local}`);
  if (!LOCAL) {
    for (const addrs of Object.values(networkInterfaces())) {
      for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  On your network:  http://${a.address}:${PORT}`);
    }
    console.log("  (password protected)");
  }
  console.log("\nKeep this window open while you use it. Ctrl+C to shut down.\n");
  if (!process.env.NO_OPEN) {
    const cmd = process.platform === "win32" ? `start "" "${local}"` : process.platform === "darwin" ? `open "${local}"` : `xdg-open "${local}"`;
    exec(cmd, () => {});
  }
});

/**
 * The in-page panel (Shadow DOM, so Amazon's CSS can't touch it): Quick scan,
 * Deep scan, summary strip, sortable table, CSV export. Exposes AxPanel.toggle().
 */
(function (root) {
  "use strict";
  const P = root.AxParse;
  const S = root.AxScan;

  const yes = (v) => (v === true ? "Yes" : v === false ? "No" : "");
  const inr = (v) => (v == null ? "" : "₹" + Number(v).toLocaleString("en-IN"));
  const n = (v) => (v == null ? "" : Number(v).toLocaleString("en-IN"));
  const origin = () => location.origin;

  /** Every column: key, header, deep-only?, display formatter, CSV value. */
  const COLUMNS = [
    { key: "position", label: "#", w: 40 },
    { key: "page", label: "Page", w: 46 },
    { key: "type", label: "Type", w: 84 },
    { key: "organicRankOverall", label: "Organic rank", w: 70 },
    { key: "sponsoredRankOverall", label: "SP rank", w: 60 },
    { key: "image", label: "", w: 44, html: (v) => (v ? `<img src="${esc(v)}" alt="">` : ""), csv: false },
    { key: "asin", label: "ASIN", w: 100, html: (v) => `<a href="${origin()}/dp/${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` },
    { key: "title", label: "Title", w: 260, cls: "wrap" },
    { key: "brand", label: "Brand", w: 110 },
    { key: "price", label: "Price", w: 70, fmt: inr },
    { key: "mrp", label: "MRP", w: 70, fmt: inr },
    { key: "discountPct", label: "Disc %", w: 56, fmt: (v) => (v == null ? "" : v + "%") },
    { key: "rating", label: "Rating", w: 56 },
    { key: "reviews", label: "Reviews", w: 72, fmt: n },
    { key: "boughtPastMonth", label: "Bought / mo", w: 80 },
    { key: "badges", label: "Badges", w: 110 },
    { key: "prime", label: "Prime", w: 52, fmt: yes },
    { key: "buyboxSeller", label: "Buy Box seller", w: 140, deep: true, html: (v, r) => (r.sellerId ? `<a href="${origin()}/sp?seller=${esc(r.sellerId)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)) },
    { key: "sellerId", label: "Seller ID", w: 120, deep: true, hidden: true },
    { key: "fulfillment", label: "Fulfilment", w: 76, deep: true },
    { key: "otherOffers", label: "Offers", w: 56, deep: true },
    { key: "availability", label: "Availability", w: 110, deep: true, hidden: true },
    { key: "bsr", label: "BSR", w: 70, deep: true, fmt: n },
    { key: "bsrCategory", label: "BSR category", w: 140, deep: true },
    { key: "subRanks", label: "Sub-category rank", w: 160, deep: true },
    { key: "manufacturer", label: "Manufacturer", w: 220, deep: true, cls: "wrap" },
    { key: "packer", label: "Packer", w: 160, deep: true, cls: "wrap" },
    { key: "importer", label: "Importer", w: 160, deep: true, cls: "wrap" },
    { key: "countryOfOrigin", label: "Origin", w: 70, deep: true },
    { key: "imageCount", label: "Images", w: 56, deep: true },
    { key: "hasAplus", label: "A+", w: 44, deep: true, fmt: yes },
    { key: "hasVideo", label: "Video", w: 50, deep: true, fmt: yes },
    { key: "bulletCount", label: "Bullets", w: 56, deep: true },
    { key: "dateFirstAvailable", label: "First available", w: 100, deep: true },
    { key: "storeName", label: "Account name", w: 140, deep: true },
    { key: "businessName", label: "Business name", w: 180, deep: true, cls: "wrap" },
    { key: "businessAddress", label: "Business address", w: 240, deep: true, cls: "wrap" },
    { key: "city", label: "City", w: 90, deep: true },
    { key: "state", label: "State", w: 100, deep: true },
    { key: "pincode", label: "PIN", w: 64, deep: true },
    { key: "sellerRating", label: "Seller rating", w: 64, deep: true },
    { key: "sellerRatingsCount", label: "Seller ratings", w: 70, deep: true, fmt: n },
  ];

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap-all { position: fixed; inset: 3vh 2vw; z-index: 2147483646; background: #fff; color: #16191f; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.35); display: flex; flex-direction: column; overflow: hidden; font-size: 13px; }
  .wrap-all.min { inset: auto 20px 20px auto; width: 340px; height: auto; }
  .wrap-all.min .body { display: none; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #131921; color: #fff; flex-wrap: wrap; }
  .logo { font-weight: 750; font-size: 14px; display: flex; align-items: center; gap: 8px; }
  .logo i { width: 22px; height: 22px; border-radius: 6px; background: #e47911; display: inline-block; }
  .ctx { color: #c8ccd2; font-size: 12.5px; margin-right: auto; max-width: 340px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button, select { font: inherit; font-size: 12.5px; font-weight: 650; border-radius: 7px; border: 1px solid #3a4553; background: #232f3e; color: #fff; padding: 6px 11px; cursor: pointer; }
  button:hover { border-color: #8a96a6; }
  button.go { background: #e47911; border-color: #e47911; color: #fff; }
  button.go2 { background: #fff; color: #131921; border-color: #fff; }
  button:disabled { opacity: .45; cursor: default; }
  .icon { padding: 6px 9px; background: transparent; border-color: transparent; font-size: 15px; line-height: 1; }
  label.tg { display: flex; align-items: center; gap: 5px; color: #dfe3e8; font-size: 12.5px; font-weight: 600; }
  .body { display: flex; flex-direction: column; min-height: 0; flex: 1; }
  .stats { display: flex; gap: 0; border-bottom: 1px solid #e6e8eb; background: #fafbfc; overflow-x: auto; }
  .stat { padding: 9px 16px; border-right: 1px solid #e6e8eb; min-width: 104px; }
  .stat b { display: block; font-size: 17px; font-variant-numeric: tabular-nums; }
  .stat span { color: #5f6b7a; font-size: 11.5px; }
  .tools { display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-bottom: 1px solid #e6e8eb; flex-wrap: wrap; }
  .tools input[type=search] { flex: 1; min-width: 160px; max-width: 320px; padding: 6px 10px; border: 1px solid #d5d9de; border-radius: 7px; font: inherit; }
  .seg { display: inline-flex; border: 1px solid #d5d9de; border-radius: 7px; overflow: hidden; }
  .seg button { background: #fff; color: #333; border: 0; border-radius: 0; padding: 6px 10px; }
  .seg button.on { background: #131921; color: #fff; }
  .status { color: #5f6b7a; font-size: 12.5px; margin-left: auto; }
  .status.warn { color: #9a5b00; font-weight: 650; }
  .prog { height: 3px; background: #eef0f2; }
  .prog i { display: block; height: 100%; width: 0; background: #e47911; transition: width .3s; }
  .tbl { flex: 1; overflow: auto; }
  table { border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #eef0f2; text-align: left; vertical-align: top; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  td.wrap { white-space: normal; }
  th { position: sticky; top: 0; background: #f3f4f6; font-weight: 650; cursor: pointer; user-select: none; z-index: 1; }
  th.deep { background: #fdf1e5; }
  th:first-child, td:first-child { position: sticky; left: 0; background: inherit; }
  th:first-child { background: #f3f4f6; z-index: 2; }
  tr { background: #fff; }
  tr.sp { background: #fffaf3; }
  tr:hover { background: #f5f8ff; }
  td img { width: 34px; height: 34px; object-fit: contain; }
  a { color: #175cd3; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .pill { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 999px; background: #eef0f2; color: #444; }
  .pill.sp { background: #fdebd3; color: #9a4a00; }
  .pill.org { background: #e5f5ec; color: #1a7f4b; }
  .empty { padding: 50px; text-align: center; color: #5f6b7a; font-size: 14px; line-height: 1.6; }
  .settings { position: absolute; right: 14px; top: 52px; background: #fff; color: #16191f; border: 1px solid #d5d9de; border-radius: 10px; padding: 14px; width: 270px; box-shadow: 0 10px 30px rgba(0,0,0,.2); z-index: 3; }
  .settings label { display: block; font-weight: 600; margin: 8px 0 4px; font-size: 12.5px; }
  .settings input { width: 70px; padding: 5px 8px; border: 1px solid #d5d9de; border-radius: 6px; font: inherit; }
  .settings button { background: #fff; color: #b42318; border-color: #d5d9de; margin-top: 12px; }
  .settings p { color: #5f6b7a; font-size: 11.5px; margin: 8px 0 0; line-height: 1.45; }
  `;

  let host = null;
  let ui = null;
  const state = { rows: [], sortKey: null, sortDir: 1, filter: "", show: "all", running: false, stop: false, settings: { minDelay: 3, maxDelay: 7, pages: 1, sellerPages: true } };

  async function loadSettings() {
    try {
      const s = (await chrome.storage.sync.get("settings")).settings;
      if (s) Object.assign(state.settings, s);
    } catch (e) {}
  }
  const saveSettings = () => chrome.storage?.sync?.set({ settings: state.settings }).catch(() => {});

  function context() {
    const kind = P.pageKind(location);
    const u = new URL(location.href);
    if (kind === "search") return { kind, label: `Search: “${u.searchParams.get("k") || ""}”` };
    if (kind === "storefront") return { kind, label: `Seller storefront: ${u.searchParams.get("me")}` };
    if (kind === "product") return { kind, label: `Product: ${P.asinFromUrl(location.href)}` };
    return { kind, label: "Open an amazon.in search, seller storefront or product page" };
  }

  function build() {
    host = document.createElement("div");
    host.id = "ax-xray-host";
    const shadow = host.attachShadow({ mode: "open" });
    const ctx = context();
    const listPage = ctx.kind === "search" || ctx.kind === "storefront";
    shadow.innerHTML = `<style>${CSS}</style>
    <div class="wrap-all">
      <div class="bar">
        <div class="logo"><i></i>AdLytics Xray</div>
        <div class="ctx" title="${esc(ctx.label)}">${esc(ctx.label)}</div>
        ${listPage ? `<select id="pages" title="How many result pages to scan, starting from this one">${[1, 2, 3, 5, 7, 10].map((p) => `<option value="${p}">${p} page${p > 1 ? "s" : ""}</option>`).join("")}</select>` : ""}
        <label class="tg" title="Also open each seller's profile for business name and address"><input type="checkbox" id="sellerPages"> Seller info</label>
        <button class="go" id="quick" ${ctx.kind === "other" ? "disabled" : ""}>⚡ Quick scan</button>
        <button class="go2" id="deep" ${ctx.kind === "other" ? "disabled" : ""}>🔎 Deep scan</button>
        <button id="stop" hidden>■ Stop</button>
        <button id="csv" disabled>⬇ CSV</button>
        <button id="index" title="Check which keywords this ASIN is indexed for (opens in a new tab)">🔑 Index Checker</button>
        <button class="icon" id="gear" title="Settings">⚙</button>
        <button class="icon" id="min" title="Minimise">–</button>
        <button class="icon" id="close" title="Close">×</button>
      </div>
      <div class="body">
        <div class="stats" id="stats"></div>
        <div class="tools">
          <input type="search" id="filter" placeholder="Filter by title, brand, seller, city…">
          <div class="seg" id="show"><button data-v="all" class="on">All</button><button data-v="Organic">Organic</button><button data-v="Sponsored">Sponsored</button></div>
          <span class="status" id="status"></span>
        </div>
        <div class="prog"><i id="bar"></i></div>
        <div class="tbl" id="tbl"><div class="empty">${
          ctx.kind === "other"
            ? "Go to an amazon.in search results page, a seller storefront or a product page, then open Xray."
            : "<b>Quick scan</b> reads this page instantly: position, organic and sponsored rank, title, brand, price, MRP, rating, reviews.<br><b>Deep scan</b> also opens every product and seller page: Buy Box, seller, FBA or FBM, BSR, manufacturer, packer, importer, A+, video, business name and address.<br><small>Deep scan goes at a human pace (3–7 s a page) and remembers results for 3 days.</small>"
        }</div></div>
      </div>
      <div class="settings" id="settings" hidden>
        <b>Deep scan pace</b>
        <label>Seconds between pages</label>
        <input type="number" id="minDelay" min="1" step="0.5"> to <input type="number" id="maxDelay" min="1" step="0.5">
        <p>Faster means more captchas. 3–7 s is a safe default for a home connection.</p>
        <button id="clear">Clear saved results (cache)</button>
      </div>
    </div>`;
    document.documentElement.appendChild(host);
    ui = (id) => shadow.getElementById(id);
    wire(shadow, ctx);
    renderStats();
  }

  function wire(shadow, ctx) {
    const s = state.settings;
    if (ui("pages")) {
      ui("pages").value = String(s.pages);
      ui("pages").onchange = (e) => ((s.pages = Number(e.target.value)), saveSettings());
    }
    ui("sellerPages").checked = s.sellerPages;
    ui("sellerPages").onchange = (e) => ((s.sellerPages = e.target.checked), saveSettings());
    ui("minDelay").value = s.minDelay;
    ui("maxDelay").value = s.maxDelay;
    ui("minDelay").onchange = (e) => ((s.minDelay = Math.max(1, Number(e.target.value) || 3)), saveSettings());
    ui("maxDelay").onchange = (e) => ((s.maxDelay = Math.max(1, Number(e.target.value) || 7)), saveSettings());
    ui("gear").onclick = () => (ui("settings").hidden = !ui("settings").hidden);
    ui("clear").onclick = async () => {
      await S.clearCache();
      status("Saved results cleared.");
    };
    ui("close").onclick = () => toggle(false);
    ui("min").onclick = () => shadow.querySelector(".wrap-all").classList.toggle("min");
    ui("stop").onclick = () => {
      state.stop = true;
      status("Stopping…");
    };
    ui("csv").onclick = exportCsv;
    ui("index").onclick = () => chrome.runtime.sendMessage({ type: "ax-open-index", asin: P.asinFromUrl(location.href) || "" });
    ui("filter").oninput = (e) => ((state.filter = e.target.value.toLowerCase()), renderTable());
    shadow.getElementById("show").onclick = (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state.show = b.dataset.v;
      shadow.querySelectorAll("#show button").forEach((x) => x.classList.toggle("on", x === b));
      renderTable();
    };
    ui("quick").onclick = () => run(ctx, false);
    ui("deep").onclick = () => run(ctx, true);
  }

  function status(msg, warn) {
    if (!ui) return;
    ui("status").textContent = msg;
    ui("status").className = "status" + (warn ? " warn" : "");
  }
  const progress = (f) => ui && (ui("bar").style.width = Math.round(f * 100) + "%");

  function busy(on) {
    state.running = on;
    ui("quick").disabled = on;
    ui("deep").disabled = on;
    ui("stop").hidden = !on;
    ui("csv").disabled = on || !state.rows.length;
  }

  async function run(ctx, deep) {
    if (state.running) return;
    state.stop = false;
    busy(true);
    progress(0);
    const s = state.settings;
    const opts = { minDelay: s.minDelay, maxDelay: s.maxDelay, sellerPages: s.sellerPages, shouldStop: () => state.stop };
    try {
      if (ctx.kind === "product") {
        status(deep && s.sellerPages ? "Reading this product and its seller…" : "Reading this product…");
        state.rows = await S.productScan({ doc: document, asin: P.asinFromUrl(location.href), opts: { ...opts, sellerPages: deep && s.sellerPages } });
        progress(1);
      } else {
        const pages = s.pages;
        state.rows = await S.quickScan({
          doc: document,
          location,
          pages,
          opts,
          onRows: (rows, p) => {
            state.rows = rows;
            status(`Search page ${p.page} of ${p.of} read · ${rows.length} listings`);
            progress(deep ? 0.1 : (p.page - (p.of - pages)) / pages);
            renderAll();
          },
        });
        if (deep) {
          const t0 = Date.now();
          await S.deepScan({
            rows: state.rows,
            opts,
            onUpdate: (row, done, total) => {
              const left = Math.round((((Date.now() - t0) / done) * (total - done)) / 1000);
              status(`Deep scan ${done} / ${total}${total - done ? ` · about ${left > 90 ? Math.round(left / 60) + " min" : left + " s"} left` : ""}`);
              progress(0.1 + 0.9 * (done / total));
              renderAll();
            },
          });
        }
      }
      status(`Done · ${state.rows.length} listings${deep ? " · deep data added" : ""}`);
      progress(1);
    } catch (e) {
      if (e.stopped) status(`Stopped · ${state.rows.length} listings kept`);
      else if (e.captcha) status("Amazon wants a captcha check. Open any amazon.in page in a new tab, solve it, then press Deep scan again (finished rows are remembered).", true);
      else {
        status("Error: " + e.message, true);
        console.error("[AdLytics Xray]", e);
      }
    } finally {
      busy(false);
      renderAll();
    }
  }

  function visibleRows() {
    let rows = state.rows;
    if (state.show !== "all") rows = rows.filter((r) => r.type === state.show);
    if (state.filter) rows = rows.filter((r) => COLUMNS.some((c) => String(r[c.key] ?? "").toLowerCase().includes(state.filter)));
    if (state.sortKey) {
      const k = state.sortKey;
      rows = [...rows].sort((a, b) => {
        const x = a[k];
        const y = b[k];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * state.sortDir;
      });
    }
    return rows;
  }

  function renderAll() {
    renderStats();
    renderTable();
  }

  function renderStats() {
    const rows = state.rows;
    const uniq = (k) => new Set(rows.map((r) => r[k]).filter(Boolean)).size;
    const avg = (k) => {
      const v = rows.map((r) => r[k]).filter((x) => typeof x === "number");
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const deep = rows.filter((r) => r.deep);
    const stats = [
      ["Listings", n(rows.length)],
      ["Organic", n(rows.filter((r) => r.type === "Organic").length)],
      ["Sponsored", n(rows.filter((r) => r.type === "Sponsored").length)],
      ["Avg price", avg("price") == null ? "–" : inr(Math.round(avg("price")))],
      ["Avg rating", avg("rating") == null ? "–" : avg("rating").toFixed(1)],
      ["Total reviews", n(rows.reduce((a, r) => a + (r.reviews || 0), 0))],
      ["Brands", n(uniq("brand"))],
    ];
    if (deep.length) {
      const fba = deep.filter((r) => r.fulfillment === "FBA").length;
      stats.push(["Sellers", n(uniq("sellerId"))], ["FBA", Math.round((fba / deep.length) * 100) + "%"], ["With address", n(new Set(deep.filter((r) => r.businessAddress).map((r) => r.sellerId)).size)]);
    }
    ui("stats").innerHTML = stats.map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("");
  }

  function renderTable() {
    if (!state.rows.length) return;
    const showDeep = state.rows.some((r) => r.deep);
    const cols = COLUMNS.filter((c) => !c.hidden && (!c.deep || showDeep));
    const rows = visibleRows();
    const arrow = (k) => (state.sortKey === k ? (state.sortDir > 0 ? " ▲" : " ▼") : "");
    ui("tbl").innerHTML = `<table><thead><tr>${cols
      .map((c) => `<th data-k="${c.key}" class="${c.deep ? "deep" : ""}" style="min-width:${c.w}px;max-width:${Math.max(c.w, 120)}px" title="${c.deep ? "Deep scan" : "Quick scan"}">${esc(c.label)}${arrow(c.key)}</th>`)
      .join("")}</tr></thead><tbody>${rows
      .map(
        (r) =>
          `<tr class="${r.type === "Sponsored" ? "sp" : ""}">${cols
            .map((c) => {
              const v = r[c.key];
              let cell;
              if (c.key === "type") cell = `<span class="pill ${v === "Sponsored" ? "sp" : v === "Organic" ? "org" : ""}">${esc(v)}</span>`;
              else if (c.html) cell = v == null || v === "" ? "" : c.html(v, r);
              else cell = esc(c.fmt ? c.fmt(v) : v);
              return `<td class="${c.cls || ""}" style="max-width:${Math.max(c.w, 120)}px" title="${esc(typeof v === "string" ? v : "")}">${cell}</td>`;
            })
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`;
    ui("tbl").querySelectorAll("th").forEach((th) => {
      th.onclick = () => {
        const k = th.dataset.k;
        state.sortDir = state.sortKey === k ? -state.sortDir : 1;
        state.sortKey = k;
        renderTable();
      };
    });
    ui("csv").disabled = state.running || !state.rows.length;
  }

  function exportCsv() {
    const cols = COLUMNS.filter((c) => c.csv !== false);
    const cell = (v) => {
      if (v == null) return "";
      let s = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [...cols.map((c) => c.label || c.key), "Product URL", "Seller profile URL", "Seller storefront URL", "Scanned from", "Scanned at"];
    const now = new Date().toISOString();
    const lines = visibleRows().map((r) =>
      [
        ...cols.map((c) => cell(r[c.key])),
        cell(`${origin()}/dp/${r.asin}`),
        cell(r.sellerId ? `${origin()}/sp?seller=${r.sellerId}` : ""),
        cell(r.sellerId ? `${origin()}/s?me=${r.sellerId}` : ""),
        cell(location.href),
        now,
      ].join(","),
    );
    const blob = new Blob(["﻿" + header.map(cell).join(",") + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const u = new URL(location.href);
    const name = (u.searchParams.get("k") || u.searchParams.get("me") || P.asinFromUrl(location.href) || "amazon").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `xray-${name}-${now.slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function toggle(force) {
    const open = !!host && host.isConnected;
    const want = force ?? !open;
    const launcher = document.getElementById("ax-xray-launcher");
    if (launcher) launcher.style.display = want ? "none" : "";
    if (want && !open) {
      await loadSettings();
      build();
      if (state.rows.length) renderAll();
    } else if (!want && open) {
      if (state.running) state.stop = true;
      host.remove();
      host = null;
    }
  }

  root.AxPanel = { toggle, COLUMNS };
})(typeof window !== "undefined" ? window : globalThis);

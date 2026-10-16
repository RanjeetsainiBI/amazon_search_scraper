/** Product Track page: ASIN input / upload, run / stop / resume, summary, table, CSV. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const T = window.AxTrack;
  const S = window.AxScan;
  const parseAsins = window.AxIndex.parseAsins;
  const MAX = 1000;
  const RUN_KEY = "pt:run"; // inputs + results of the current / last run
  const SNAP_KEY = "pt:snap"; // latest snapshot per ASIN across all runs (baseline for "changed")
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const inr = (v) => (v == null ? "" : "₹" + Number(v).toLocaleString("en-IN"));
  const n = (v) => (v == null ? "" : Number(v).toLocaleString("en-IN"));

  const st = {
    asins: [],
    own: [],
    results: {}, // asin -> snapshot (this run)
    baseline: {}, // asin -> snapshot from before this run
    runKey: null,
    running: false,
    stop: false,
    view: "all",
    filter: "",
    sortKey: null,
    sortDir: 1,
    settings: { minDelay: 3, maxDelay: 7 },
  };

  // ------------------------------------------------------------ storage

  const store = () => (typeof chrome !== "undefined" && chrome.storage ? chrome.storage : null);
  async function load() {
    try {
      const s = (await store().sync.get("settings")).settings;
      if (s) Object.assign(st.settings, { minDelay: s.minDelay ?? 3, maxDelay: s.maxDelay ?? 7 });
      const r = (await store().local.get(RUN_KEY))[RUN_KEY];
      if (r) {
        $("asins").value = r.asinsText || "";
        $("own").value = r.ownText || "";
        st.results = r.results || {};
        st.baseline = r.baseline || {};
        st.runKey = r.runKey || null;
      }
    } catch (e) {}
    $("minDelay").value = st.settings.minDelay;
    $("maxDelay").value = st.settings.maxDelay;
  }
  function saveRun() {
    try {
      store().local.set({ [RUN_KEY]: { asinsText: $("asins").value, ownText: $("own").value, results: st.results, baseline: st.baseline, runKey: st.runKey } });
    } catch (e) {}
  }
  async function getSnaps() {
    try {
      return (await store().local.get(SNAP_KEY))[SNAP_KEY] || {};
    } catch (e) {
      return {};
    }
  }
  async function putSnap(asin, snap) {
    try {
      const all = await getSnaps();
      all[asin] = snap;
      await store().local.set({ [SNAP_KEY]: all });
    } catch (e) {}
  }
  function saveSettings() {
    try {
      store().sync.get("settings").then((r) => store().sync.set({ settings: { ...(r.settings || {}), minDelay: st.settings.minDelay, maxDelay: st.settings.maxDelay } }));
    } catch (e) {}
  }

  // ------------------------------------------------------------ inputs

  function readInputs() {
    const all = parseAsins($("asins").value);
    st.asins = all.slice(0, MAX);
    st.own = T.parseOwn($("own").value);
    $("asinCount").textContent = all.length
      ? `${all.length.toLocaleString("en-IN")} ASIN${all.length > 1 ? "s" : ""}${all.length > MAX ? ` (first ${MAX} will be checked)` : ""}`
      : "paste ASINs or product links (up to 1,000)";
    const per = (st.settings.minDelay + st.settings.maxDelay) / 2 + 1.5;
    const secs = st.asins.length * per;
    $("est").innerHTML = st.asins.length
      ? `<b>${st.asins.length}</b> product pages · about <b>${secs < 90 ? Math.round(secs) + " s" : Math.round(secs / 60) + " min"}</b>`
      : "Paste ASINs to see how long it will take.";
    render();
  }

  async function onFile(e) {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    const found = parseAsins(text);
    if (!found.length) {
      $("err").textContent = `No ASINs found in ${f.name}.`;
      return;
    }
    const existing = parseAsins($("asins").value);
    const added = found.filter((a) => !existing.includes(a));
    $("asins").value = [...existing, ...added].join("\n");
    $("err").textContent = "";
    status(`Added ${added.length} ASINs from ${f.name}${found.length > added.length ? ` (${found.length - added.length} already in the list)` : ""}.`);
    e.target.value = "";
    readInputs();
    saveRun();
  }

  // ------------------------------------------------------------ run

  const runKeyOf = () => JSON.stringify(st.asins);
  function status(msg, warn) {
    $("status").textContent = msg;
    $("status").className = "status" + (warn ? " warn" : "");
  }
  function busy(on) {
    st.running = on;
    $("start").disabled = on;
    $("stop").hidden = !on;
    $("asins").disabled = on;
    $("file").disabled = on;
    if (on) $("resume").hidden = true;
  }

  async function start(resume) {
    readInputs();
    $("err").textContent = "";
    if (!st.asins.length) return ($("err").textContent = "Add at least one ASIN (B0… or a product link).");
    if (!resume || st.runKey !== runKeyOf()) {
      // New run: what we knew before becomes the baseline for "changed".
      const snaps = await getSnaps();
      st.baseline = {};
      for (const a of st.asins) if (snaps[a]) st.baseline[a] = snaps[a];
      st.results = {};
      st.runKey = runKeyOf();
    }
    st.stop = false;
    busy(true);
    saveRun();
    render();
    const t0 = Date.now();
    let fetched = 0;
    const fetchDoc = S.makeFetcher({ minDelay: st.settings.minDelay, maxDelay: st.settings.maxDelay, shouldStop: () => st.stop, onFetch: () => fetched++ });
    try {
      await T.run({
        asins: st.asins,
        fetchDoc,
        results: st.results,
        shouldStop: () => st.stop,
        onRow: async (asin, snap) => {
          saveRun();
          await putSnap(asin, snap);
          render();
        },
        onProgress: (done, total) => {
          $("bar").style.width = Math.round((done / total) * 100) + "%";
          const left = fetched ? Math.round((((Date.now() - t0) / fetched) * (total - done)) / 1000) : null;
          status(`${done} / ${total} checked${left && total > done ? ` · about ${left > 90 ? Math.round(left / 60) + " min" : left + " s"} left` : ""}`);
        },
      });
      $("bar").style.width = "100%";
      status(`Done · ${st.asins.length} ASINs checked`);
    } catch (e) {
      if (e.stopped) status("Stopped · checked ASINs are kept. Press Resume to continue.");
      else if (e.captcha) status("Amazon wants a captcha check. Open amazon.in in another tab, solve it, then press Resume.", true);
      else {
        status("Error: " + e.message, true);
        console.error("[Product Track]", e);
      }
      $("resume").hidden = false;
    } finally {
      busy(false);
      saveRun();
      render();
    }
  }

  // ------------------------------------------------------------ output

  function rows() {
    return st.asins.filter((a) => st.results[a]).map((a) => {
      const s = st.results[a];
      const own = T.owner(s, st.own);
      const ch = T.changes(st.baseline[a], s);
      return { ...s, owner: own, changes: ch };
    });
  }

  const VIEWS = {
    all: { label: "Checked", cls: "", test: () => true },
    you: { label: "You hold Buy Box", cls: "ok", test: (r) => r.owner === "you", needsOwn: true },
    other: { label: "Lost to others", cls: "bad", test: (r) => r.owner === "other", needsOwn: true },
    buybox: { label: "Has Buy Box", cls: "ok", test: (r) => r.status === "buybox", hideWithOwn: true },
    no_buybox: { label: "No Buy Box", cls: "bad", test: (r) => r.status === "no_buybox" },
    unavailable: { label: "Unavailable", cls: "warn", test: (r) => r.status === "unavailable" },
    not_found: { label: "Not found", cls: "bad", test: (r) => r.status === "not_found" },
    changed: { label: "Changed since last", cls: "info", test: (r) => r.changes.length > 0 },
  };

  const COLS = [
    { k: "asin", h: "ASIN", cls: "mono", html: (r) => `<a href="https://www.amazon.in/dp/${r.asin}" target="_blank" rel="noopener">${r.asin}</a>` },
    { k: "status", h: "Status", html: (r) => `<span class="pill ${r.status}">${T.label(r.status)}</span>` },
    { k: "buyboxSeller", h: "Buy Box seller", html: (r) => (r.sellerId ? `<a href="https://www.amazon.in/sp?seller=${r.sellerId}" target="_blank" rel="noopener">${esc(r.buyboxSeller)}</a>` : esc(r.buyboxSeller)) },
    { k: "owner", h: "Who", html: (r) => (r.owner === "you" ? `<span class="pill you">You</span>` : r.owner === "other" ? `<span class="pill other">Other seller</span>` : r.owner === "none" ? `<span class="pill">Nobody</span>` : "") },
    { k: "fulfillment", h: "Fulfilment" },
    { k: "price", h: "Price", fmt: inr },
    { k: "mrp", h: "MRP", fmt: inr },
    { k: "otherOffers", h: "Offers" },
    { k: "changes", h: "Change since last check", cls: "wrap", html: (r) => r.changes.map((c) => `<span class="chg ${c.kind}">${esc(c.text)}</span>`).join(""), sort: (r) => r.changes.length },
    { k: "title", h: "Title", cls: "wrap" },
    { k: "brand", h: "Brand" },
    { k: "availability", h: "Availability", cls: "wrap" },
    { k: "rating", h: "Rating" },
    { k: "reviews", h: "Reviews", fmt: n },
    { k: "bsr", h: "BSR", fmt: n },
    { k: "sellerId", h: "Seller ID", cls: "mono" },
    { k: "checkedAt", h: "Checked", fmt: (v) => (v ? new Date(v).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "") },
  ];

  function render() {
    const all = rows();
    const hasOwn = st.own.length > 0;
    const views = Object.entries(VIEWS).filter(([, v]) => (!v.needsOwn || hasOwn) && !(v.hideWithOwn && hasOwn));
    if (!views.some(([k]) => k === st.view)) st.view = "all";
    $("sum").innerHTML = all.length
      ? views.map(([k, v]) => `<button class="tile ${v.cls} ${st.view === k ? "on" : ""}" data-v="${k}"><b>${all.filter(v.test).length.toLocaleString("en-IN")}</b><span>${v.label}</span></button>`).join("")
      : "";

    let list = all.filter(VIEWS[st.view].test);
    if (st.filter) list = list.filter((r) => [r.asin, r.title, r.brand, r.buyboxSeller, r.sellerId].some((v) => String(v || "").toLowerCase().includes(st.filter)));
    if (st.sortKey) {
      const col = COLS.find((c) => c.k === st.sortKey);
      const val = (r) => (col.sort ? col.sort(r) : r[col.k]);
      list = [...list].sort((a, b) => {
        const x = val(a);
        const y = val(b);
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * st.sortDir;
      });
    }
    const cols = COLS.filter((c) => c.k !== "owner" || hasOwn);
    if (!all.length) {
      $("tbl").innerHTML = `<div class="empty">Results show here as each ASIN is checked.</div>`;
    } else {
      const arrow = (k) => (st.sortKey === k ? (st.sortDir > 0 ? " ▲" : " ▼") : "");
      $("tbl").innerHTML = `<table><thead><tr>${cols.map((c) => `<th data-k="${c.k}" class="${c.cls === "mono" ? "mono" : ""}">${c.h}${arrow(c.k)}</th>`).join("")}</tr></thead><tbody>${
        list.map((r) => `<tr>${cols.map((c) => `<td class="${c.cls || ""}">${c.html ? c.html(r) : esc(c.fmt ? c.fmt(r[c.k]) : r[c.k])}</td>`).join("")}</tr>`).join("") ||
        `<tr><td colspan="${cols.length}" class="empty">Nothing matches.</td></tr>`
      }</tbody></table>`;
    }
    $("csv").disabled = st.running || !all.length;
  }

  function exportCsv() {
    const q = (v) => {
      if (v == null) return "";
      let s = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const hasOwn = st.own.length > 0;
    const head = ["ASIN", "Status", "Buy Box seller", "Seller ID", ...(hasOwn ? ["Who holds Buy Box"] : []), "Fulfilment", "Price", "MRP", "Other offers", "Availability", "Change since last check", "Title", "Brand", "Rating", "Reviews", "BSR", "BSR category", "Product URL", "Seller URL", "Checked at"];
    const who = { you: "You", other: "Other seller", none: "Nobody" };
    const list = rows().filter(VIEWS[st.view].test);
    const lines = list.map((r) =>
      [
        r.asin, T.label(r.status), r.buyboxSeller, r.sellerId, ...(hasOwn ? [who[r.owner] || ""] : []), r.fulfillment, r.price, r.mrp, r.otherOffers, r.availability,
        r.changes.map((c) => c.text).join("; "), r.title, r.brand, r.rating, r.reviews, r.bsr, r.bsrCategory,
        `https://www.amazon.in/dp/${r.asin}`, r.sellerId ? `https://www.amazon.in/sp?seller=${r.sellerId}` : "", r.checkedAt,
      ].map(q).join(","),
    );
    const blob = new Blob(["﻿" + head.join(",") + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `product-track-${st.view === "all" ? "" : st.view + "-"}${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ------------------------------------------------------------ wiring

  document.addEventListener("DOMContentLoaded", async () => {
    await load();
    readInputs();
    if (st.runKey && st.runKey === runKeyOf() && st.asins.some((a) => !st.results[a])) $("resume").hidden = false;
    $("asins").addEventListener("input", () => (readInputs(), saveRun()));
    $("own").addEventListener("input", () => (readInputs(), saveRun()));
    $("file").addEventListener("change", onFile);
    $("clear").addEventListener("click", () => {
      $("asins").value = "";
      readInputs();
      saveRun();
    });
    $("minDelay").addEventListener("change", (e) => ((st.settings.minDelay = Math.max(1, Number(e.target.value) || 3)), saveSettings(), readInputs()));
    $("maxDelay").addEventListener("change", (e) => ((st.settings.maxDelay = Math.max(1, Number(e.target.value) || 7)), saveSettings(), readInputs()));
    $("start").addEventListener("click", () => start(false));
    $("resume").addEventListener("click", () => start(true));
    $("stop").addEventListener("click", () => {
      st.stop = true;
      status("Stopping…");
    });
    $("csv").addEventListener("click", exportCsv);
    $("filter").addEventListener("input", (e) => ((st.filter = e.target.value.toLowerCase()), render()));
    $("sum").addEventListener("click", (e) => {
      const b = e.target.closest(".tile");
      if (!b) return;
      st.view = b.dataset.v;
      render();
    });
    $("tbl").addEventListener("click", (e) => {
      const th = e.target.closest("th");
      if (!th) return;
      st.sortDir = st.sortKey === th.dataset.k ? -st.sortDir : 1;
      st.sortKey = th.dataset.k;
      render();
    });
  });
})();

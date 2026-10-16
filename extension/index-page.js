/** Index Checker page: inputs, run / stop / resume, live results grid, CSV. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const I = window.AxIndex;
  const S = window.AxScan;
  const MAX_ASINS = 10;
  const MAX_KEYWORDS = 200;
  const SAVE_KEY = "ix:last";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  const st = { asins: [], keywords: [], pages: 3, results: {}, running: false, stop: false, show: "all", runKey: null, settings: { minDelay: 3, maxDelay: 7 } };

  // ------------------------------------------------------------ persistence

  const storage = () => (typeof chrome !== "undefined" && chrome.storage ? chrome.storage : null);
  async function load() {
    try {
      const s = (await storage().sync.get("settings")).settings;
      if (s) Object.assign(st.settings, { minDelay: s.minDelay ?? 3, maxDelay: s.maxDelay ?? 7 });
      const last = (await storage().local.get(SAVE_KEY))[SAVE_KEY];
      if (last) {
        $("asins").value = last.asinsText || "";
        $("keywords").value = last.keywordsText || "";
        $("pages").value = String(last.pages ?? 3);
        st.results = last.results || {};
        st.runKey = last.runKey || null;
      }
    } catch (e) {}
    const fromUrl = new URLSearchParams(location.search).get("asin");
    if (fromUrl && !I.parseAsins($("asins").value).includes(fromUrl.toUpperCase())) {
      $("asins").value = [fromUrl.toUpperCase(), $("asins").value.trim()].filter(Boolean).join("\n");
    }
    $("minDelay").value = st.settings.minDelay;
    $("maxDelay").value = st.settings.maxDelay;
  }
  function save() {
    try {
      storage().local.set({ [SAVE_KEY]: { asinsText: $("asins").value, keywordsText: $("keywords").value, pages: Number($("pages").value), results: st.results, runKey: st.runKey } });
    } catch (e) {}
  }
  function saveSettings() {
    try {
      storage().sync.get("settings").then((r) => storage().sync.set({ settings: { ...(r.settings || {}), minDelay: st.settings.minDelay, maxDelay: st.settings.maxDelay } }));
    } catch (e) {}
  }

  // ------------------------------------------------------------ inputs

  function readInputs() {
    st.asins = I.parseAsins($("asins").value).slice(0, MAX_ASINS);
    st.keywords = I.parseKeywords($("keywords").value).slice(0, MAX_KEYWORDS);
    st.pages = Number($("pages").value);
    const extraA = I.parseAsins($("asins").value).length - st.asins.length;
    const extraK = I.parseKeywords($("keywords").value).length - st.keywords.length;
    $("asinCount").textContent = st.asins.length ? `${st.asins.length} ASIN${st.asins.length > 1 ? "s" : ""}${extraA > 0 ? ` (${extraA} over the limit, ignored)` : ""}` : "one per line, or product links (up to 10)";
    $("kwCount").textContent = st.keywords.length ? `${st.keywords.length} keyword${st.keywords.length > 1 ? "s" : ""}${extraK > 0 ? ` (${extraK} over the limit, ignored)` : ""}` : "one per line (up to 200)";
    estimate();
  }

  function estimate() {
    const k = st.keywords.length;
    const a = st.asins.length;
    if (!k || !a) {
      $("est").textContent = "Add ASINs and keywords to see how long it will take.";
      return;
    }
    const idx = k * a;
    const worst = I.estimateRequests(k, a, st.pages);
    const per = (st.settings.minDelay + st.settings.maxDelay) / 2 + 1.5;
    const fmt = (n) => {
      const s = Math.round(n * per);
      return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
    };
    $("est").innerHTML = st.pages
      ? `<b>${idx}</b> index searches + up to <b>${k * st.pages}</b> rank searches · about <b>${fmt(idx)}</b> to <b>${fmt(worst)}</b> (rank searches run only for indexed keywords)`
      : `<b>${idx}</b> searches · about <b>${fmt(idx)}</b>`;
  }

  // Same inputs as the saved run, so Resume can reuse its finished cells.
  const runKeyOf = () => JSON.stringify([st.asins, st.keywords, st.pages]);

  // ------------------------------------------------------------ run

  function busy(on) {
    st.running = on;
    $("start").disabled = on;
    $("suggest").disabled = on;
    $("stop").hidden = !on;
    ["asins", "keywords", "pages"].forEach((id) => ($(id).disabled = on));
    if (on) $("resume").hidden = true;
  }
  function status(msg, warn) {
    $("status").textContent = msg;
    $("status").className = "status" + (warn ? " warn" : "");
  }

  async function start(resume) {
    readInputs();
    $("err").textContent = "";
    if (!st.asins.length) return ($("err").textContent = "Add at least one ASIN (B0… or a product link).");
    if (!st.keywords.length) return ($("err").textContent = "Add at least one keyword.");
    const key = runKeyOf();
    if (!resume || st.runKey !== key) {
      st.results = {};
      st.runKey = key;
    }
    st.stop = false;
    busy(true);
    render();
    const t0 = Date.now();
    let fetched = 0;
    const fetchDoc = S.makeFetcher({ minDelay: st.settings.minDelay, maxDelay: st.settings.maxDelay, shouldStop: () => st.stop, onFetch: () => fetched++ });
    try {
      await I.run({
        keywords: st.keywords,
        asins: st.asins,
        pages: st.pages,
        fetchDoc,
        prior: st.results,
        shouldStop: () => st.stop,
        onResult: () => {
          save();
          render();
        },
        onProgress: (done, total, label) => {
          $("bar").style.width = Math.round((done / total) * 100) + "%";
          const left = fetched ? Math.round((((Date.now() - t0) / fetched) * (total - done)) / 1000) : null;
          status(`${done} / ${total} · ${label}${left && total > done ? ` · about ${left > 90 ? Math.round(left / 60) + " min" : left + " s"} left` : ""}`);
        },
      });
      $("bar").style.width = "100%";
      status(`Done · ${st.keywords.length} keywords × ${st.asins.length} ASIN${st.asins.length > 1 ? "s" : ""}`);
    } catch (e) {
      if (e.stopped) status("Stopped · finished results are kept. Press Resume to continue.");
      else if (e.captcha) status("Amazon wants a captcha check. Open amazon.in in another tab, solve it, then press Resume.", true);
      else {
        status("Error: " + e.message, true);
        console.error("[Index Checker]", e);
      }
      $("resume").hidden = false;
    } finally {
      busy(false);
      save();
      render();
    }
  }

  async function suggest() {
    readInputs();
    $("err").textContent = "";
    const asin = st.asins[0];
    if (!asin) return ($("err").textContent = "Add an ASIN first. Keyword ideas come from its listing.");
    $("suggest").disabled = true;
    status(`Reading ${asin}'s listing…`);
    try {
      const doc = await S.makeFetcher({ minDelay: 0, maxDelay: 0, shouldStop: () => false })(`https://www.amazon.in/dp/${asin}?th=1&psc=1`);
      const ideas = I.suggestKeywords(I.listingText(doc, asin), 40);
      if (!ideas.length) throw new Error("No title or bullets found on that page.");
      const existing = I.parseKeywords($("keywords").value);
      const added = ideas.filter((k) => !existing.includes(k));
      $("keywords").value = [...existing, ...added].join("\n");
      readInputs();
      save();
      status(`Added ${added.length} keyword ideas from ${asin}. Remove the ones you don't want, then press Check index.`);
    } catch (e) {
      status(e.captcha ? "Amazon wants a captcha check. Open amazon.in in another tab, solve it, then try again." : "Couldn't read the listing: " + e.message, true);
    } finally {
      $("suggest").disabled = false;
    }
  }

  // ------------------------------------------------------------ output

  const cell = (k, a) => (st.results[k] || {})[a] || {};
  const anyIndexed = (k) => st.asins.some((a) => cell(k, a).indexed === true);
  const allChecked = (k) => st.asins.every((a) => typeof cell(k, a).indexed === "boolean");

  function render() {
    const asins = st.asins.length ? st.asins : I.parseAsins($("asins").value).slice(0, MAX_ASINS);
    const keywords = st.keywords.length ? st.keywords : I.parseKeywords($("keywords").value).slice(0, MAX_KEYWORDS);
    const checked = keywords.filter((k) => Object.keys(st.results[k] || {}).length);
    if (!checked.length) {
      $("sum").innerHTML = "";
      $("tbl").innerHTML = `<div class="empty">Results show here as each keyword is checked.</div>`;
      $("csv").disabled = $("copyNo").disabled = true;
      return;
    }

    $("sum").innerHTML = asins
      .map((a) => {
        const done = keywords.filter((k) => typeof cell(k, a).indexed === "boolean");
        const yes = done.filter((k) => cell(k, a).indexed).length;
        const p1 = done.filter((k) => cell(k, a).organicPage === 1).length;
        const pct = done.length ? Math.round((yes / done.length) * 100) : 0;
        return `<div class="tile"><div class="asin"><a href="https://www.amazon.in/dp/${a}" target="_blank" rel="noopener">${a}</a></div>
          <b>${yes}</b> / ${done.length} indexed <small>(${pct}%)</small>
          <div class="bar"><i style="width:${pct}%"></i></div>
          <small>${st.pages ? `${p1} keyword${p1 === 1 ? "" : "s"} on page 1 organically` : "rank check off"}</small></div>`;
      })
      .join("");

    let rows = keywords;
    if (st.show === "no") rows = rows.filter((k) => allChecked(k) && st.asins.some((a) => cell(k, a).indexed === false));
    if (st.show === "yes") rows = rows.filter(anyIndexed);

    const rankText = (c) => {
      if (!st.pages || !c.indexed) return "";
      if (!c.ranked) return `<span class="rank">rank: checking…</span>`;
      const o = c.organicRank ? `Org <b>#${c.organicRank}</b> · p${c.organicPage}` : `Org: not in top ${st.pages} page${st.pages > 1 ? "s" : ""}`;
      const sp = c.sponsoredRank ? ` · SP <b>#${c.sponsoredRank}</b> · p${c.sponsoredPage}` : "";
      return `<span class="rank">${o}${sp}</span>`;
    };
    $("tbl").innerHTML = `<table><thead><tr><th>Keyword</th>${asins.map((a) => `<th class="asin"><a href="https://www.amazon.in/dp/${a}" target="_blank" rel="noopener">${a}</a></th>`).join("")}</tr></thead><tbody>${
      rows
        .map(
          (k) =>
            `<tr><td class="kw"><a href="https://www.amazon.in/s?k=${encodeURIComponent(k)}" target="_blank" rel="noopener">${esc(k)}</a></td>${asins
              .map((a) => {
                const c = cell(k, a);
                const badge = c.indexed === true ? `<span class="badge yes" title="${c.indexedByRank ? "The ASIN search didn't return it, but it ranks organically for this keyword, so it is indexed" : ""}">✓ Indexed</span>` : c.indexed === false ? `<span class="badge no">✗ Not indexed</span>` : `<span class="badge wait">…</span>`;
                return `<td>${badge}${rankText(c)}</td>`;
              })
              .join("")}</tr>`,
        )
        .join("") || `<tr><td colspan="${asins.length + 1}" class="empty">Nothing matches this filter.</td></tr>`
    }</tbody></table>`;
    $("csv").disabled = st.running;
    $("copyNo").disabled = !keywords.some((k) => allChecked(k) && st.asins.some((a) => cell(k, a).indexed === false));
  }

  function exportCsv() {
    const q = (v) => {
      if (v == null) return "";
      let s = typeof v === "boolean" ? (v ? "Yes" : "No") : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Keyword", "ASIN", "Indexed", "Organic rank", "Organic page", "Sponsored rank", "Sponsored page", "Pages checked", "Search URL", "Checked at"];
    const now = new Date().toISOString();
    const lines = [];
    for (const k of st.keywords) {
      for (const a of st.asins) {
        const c = cell(k, a);
        if (typeof c.indexed !== "boolean") continue;
        lines.push([k, a, c.indexed, c.organicRank, c.organicPage, c.sponsoredRank, c.sponsoredPage, c.ranked ? st.pages : "", I.searchUrl(k, 1), now].map(q).join(","));
      }
    }
    const blob = new Blob(["﻿" + head.join(",") + "\n" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `index-check-${st.asins.slice(0, 3).join("-")}-${now.slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function copyNotIndexed() {
    const list = st.keywords.filter((k) => allChecked(k) && st.asins.some((a) => cell(k, a).indexed === false));
    try {
      await navigator.clipboard.writeText(list.join("\n"));
      status(`Copied ${list.length} not-indexed keyword${list.length === 1 ? "" : "s"}.`);
    } catch (e) {
      status("Couldn't copy: your browser blocked clipboard access.", true);
    }
  }

  // ------------------------------------------------------------ wiring

  document.addEventListener("DOMContentLoaded", async () => {
    await load();
    readInputs();
    // A saved run that matches the inputs and isn't finished can be resumed.
    if (st.runKey && st.runKey === runKeyOf() && !st.keywords.every(allChecked)) $("resume").hidden = false;
    render();
    $("asins").addEventListener("input", () => (readInputs(), save()));
    $("keywords").addEventListener("input", () => (readInputs(), save()));
    $("pages").addEventListener("change", () => (readInputs(), save()));
    $("minDelay").addEventListener("change", (e) => ((st.settings.minDelay = Math.max(1, Number(e.target.value) || 3)), saveSettings(), estimate()));
    $("maxDelay").addEventListener("change", (e) => ((st.settings.maxDelay = Math.max(1, Number(e.target.value) || 7)), saveSettings(), estimate()));
    $("start").addEventListener("click", () => start(false));
    $("resume").addEventListener("click", () => start(true));
    $("stop").addEventListener("click", () => {
      st.stop = true;
      status("Stopping…");
    });
    $("suggest").addEventListener("click", suggest);
    $("clearKw").addEventListener("click", () => {
      $("keywords").value = "";
      readInputs();
      save();
    });
    $("csv").addEventListener("click", exportCsv);
    $("copyNo").addEventListener("click", copyNotIndexed);
    $("show").addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      st.show = b.dataset.v;
      document.querySelectorAll("#show button").forEach((x) => x.classList.toggle("on", x === b));
      render();
    });
  });
})();

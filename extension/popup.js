/** Toolbar popup: the three entry points. */
(async function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  $("ver").textContent = "v" + chrome.runtime.getManifest().version;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let kind = "other";
  try {
    if (tab && /^https:\/\/www\.amazon\.in\//.test(tab.url || "")) kind = AxParse.pageKind(new URL(tab.url));
  } catch (e) {}
  const scannable = kind === "search" || kind === "storefront" || kind === "product";
  const asin = tab && tab.url ? AxParse.asinFromUrl(tab.url) : null;
  if (!scannable) {
    $("download").disabled = true;
    $("downloadNote").hidden = false;
  }

  // Opens one of the extension's own pages next to the current tab.
  async function openPage(file, query) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(file) + (query || ""), index: tab ? tab.index + 1 : undefined });
    window.close();
  }

  $("download").addEventListener("click", async () => {
    if (!scannable) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: "ax-toggle" });
    } catch (e) {
      // Tab was open before the extension was installed: load the scripts first.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["parse.js", "scan.js", "panel.js", "content.js"] });
      await chrome.tabs.sendMessage(tab.id, { type: "ax-toggle" });
    }
    window.close();
  });
  $("rank").addEventListener("click", () => openPage("index.html", asin ? `?asin=${asin}` : ""));
  $("product").addEventListener("click", () => openPage("product.html"));
})();

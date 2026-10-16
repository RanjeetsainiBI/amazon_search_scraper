const indexUrl = (asin) => chrome.runtime.getURL("index.html") + (asin ? `?asin=${encodeURIComponent(asin)}` : "");

// Toolbar icon: on amazon.in it toggles the Xray panel; anywhere else it opens the Index Checker.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https:\/\/www\.amazon\.in\//.test(tab.url || "")) {
    chrome.tabs.create({ url: indexUrl() });
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "ax-toggle" });
  } catch {
    // Tab was open before the extension was installed: load the scripts first.
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["parse.js", "scan.js", "panel.js", "content.js"] });
    await chrome.tabs.sendMessage(tab.id, { type: "ax-toggle" });
  }
});

// The panel's "Index Checker" button (content scripts can't open extension pages themselves).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "ax-open-index") {
    const asin = /^[A-Z0-9]{10}$/.test(msg.asin || "") ? msg.asin : "";
    chrome.tabs.create({ url: indexUrl(asin), index: sender.tab ? sender.tab.index + 1 : undefined });
  }
});

// The toolbar icon opens popup.html (Download Result / Rank Track / Product Track).
// This worker only handles the panel's "Index Checker" button, because content
// scripts can't open extension pages themselves.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "ax-open-index") {
    const asin = /^[A-Z0-9]{10}$/.test(msg.asin || "") ? msg.asin : "";
    chrome.tabs.create({ url: chrome.runtime.getURL("index.html") + (asin ? `?asin=${encodeURIComponent(asin)}` : ""), index: sender.tab ? sender.tab.index + 1 : undefined });
  }
});

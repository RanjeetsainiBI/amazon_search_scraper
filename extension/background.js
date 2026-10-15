// Toolbar icon toggles the panel on the current amazon.in tab.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https:\/\/www\.amazon\.in\//.test(tab.url || "")) {
    chrome.tabs.create({ url: "https://www.amazon.in/" });
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

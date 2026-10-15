/**
 * Entry point on amazon.in pages: a small launcher button on search,
 * storefront and product pages, and the toolbar icon toggles the panel.
 */
(function () {
  "use strict";
  if (window.__axXrayLoaded) return;
  window.__axXrayLoaded = true;

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "ax-toggle") AxPanel.toggle();
  });

  const kind = AxParse.pageKind(location);
  if (kind === "other" || window.top !== window) return;
  const btn = document.createElement("div");
  btn.id = "ax-xray-launcher";
  btn.attachShadow({ mode: "open" }).innerHTML = `<style>
    button { position: fixed; right: 18px; bottom: 18px; z-index: 2147483645; display: flex; align-items: center; gap: 7px;
      padding: 9px 14px 9px 10px; border-radius: 999px; border: 0; background: #131921; color: #fff; cursor: pointer;
      font: 650 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
    button:hover { background: #232f3e; }
    i { width: 18px; height: 18px; border-radius: 5px; background: #e47911; display: inline-block; }
  </style><button title="Open AdLytics Xray"><i></i>Xray</button>`;
  btn.shadowRoot.querySelector("button").onclick = () => AxPanel.toggle();
  document.documentElement.appendChild(btn);
})();

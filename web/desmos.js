"use strict";
/* Interactive Desmos figures inside the study notes.
 *
 * The figure definitions live on window.LA_NOTES._desmos (filled by notes.js'
 * blocksHtml) and each DOM node points at one of them via data-desmos-idx.
 *
 * The drawing engine is Desmos; the key comes from web/desmos-config.js.
 * Local preview (file:// or localhost) reuses Desmos' public demo key, but a
 * deployed site must supply its own free key.
 */
(function () {
  // Desmos' public demo key — for development / local preview only.
  // Production deployments must replace it with their own (desmos.com/my-api).
  var DEMO_KEY = "dcb31709b452b1cf9dc26972add0fda6";
  var apiPromise = null;

  function resolveKey() {
    var k = (window.LA_DESMOS_KEY || "").trim();
    if (k) return k;
    // Local preview (file:// or localhost) uses the demo key so you can see the
    // figures immediately; a real https deploy requires your own key.
    var proto = location.protocol, host = location.hostname;
    if (proto === "file:" || host === "localhost" || host === "127.0.0.1") {
      return DEMO_KEY;
    }
    return "";
  }

  function ensureApi() {
    if (apiPromise) return apiPromise;
    apiPromise = new Promise(function (resolve, reject) {
      var key = resolveKey();
      if (!key) { reject(new Error("no-key")); return; }
      if (window.Desmos) { resolve(window.Desmos); return; }
      var s = document.createElement("script");
      s.src = "https://www.desmos.com/api/v1.5/calculator.js?apiKey=" +
        encodeURIComponent(key);
      s.async = true;
      s.onload = function () { resolve(window.Desmos); };
      s.onerror = function () { reject(new Error("load-failed")); };
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  function t(key, fallback) {
    return (window.LA_I18N && window.LA_I18N.t)
      ? window.LA_I18N.t(key) : fallback;
  }

  function mount(host) {
    var idx = parseInt(host.getAttribute("data-desmos-idx"), 10);
    var list = window.LA_NOTES && window.LA_NOTES._desmos;
    var def = list && list[idx];
    if (!def) {
      host.classList.add("desmos-empty");
      host.textContent = t("desmos.noData", "(figure data missing)");
      return;
    }
    ensureApi().then(function (Desmos) {
      var opts = Object.assign({
        keypad: false,
        expressions: true,
        settingsMenu: false,
        zoomButtons: true,
        lockViewport: false,
        border: true,
        expressionsTopbar: false,
        pointsOfInterest: false,
        expressionsCollapsed: true,
        qwertyKeyboard: false
      }, def.options || {});
      var calc = Desmos.GraphingCalculator(host, opts);
      (def.expressions || []).forEach(function (e, i) {
        var expr = Object.assign({ id: "e" + i }, e);
        if (expr.slider) { expr.sliderBounds = expr.slider; delete expr.slider; }
        calc.setExpression(expr);
      });
      if (def.viewport) {
        calc.setMathBounds({
          left: def.viewport.xmin,
          right: def.viewport.xmax,
          bottom: def.viewport.ymin,
          top: def.viewport.ymax
        });
      }
      host._desmosCalc = calc;
    }).catch(function (err) {
      host.classList.add("desmos-missing");
      var msg = (err && err.message === "no-key")
        ? t("desmos.noKey", "Desmos API key not set.")
        : t("desmos.loadFail", "Desmos failed to load.");
      host.textContent = msg;
    });
  }

  function mountAll(root) {
    (root || document).querySelectorAll(".desmos-host[data-desmos-idx]")
      .forEach(function (host) {
        if (host._desmosCalc) return;
        mount(host);
      });
  }

  window.LA_DESMOS = {
    ensureApi: ensureApi,
    mountAll: mountAll,
    mount: mount
  };
})();

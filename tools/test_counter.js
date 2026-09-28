"use strict";
/* 页脚「使用人数」计数逻辑的回归测试（Node，无浏览器）。
 *
 * app.js 里的 initUsageCounter 是最后一个 IIFE；本脚本把它整段抽出来，在 vm 里
 * 用假的 DOM / localStorage / fetch 跑一遍，验证几件关键的事：
 *   1. 本机第一次打开 -> /hit（+1），并记下 la-counted
 *   2. 之后（或拿不到 localStorage）-> /get，绝不重复虚增
 *   3. 数字渲染成 <b>（加粗），en n=1 用单数 "1 person"
 *   4. zh 用千分位
 *
 * 用法：node tools/test_counter.js   （失败 exit 1）
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.resolve(__dirname, "..", "web");
const appSrc = fs.readFileSync(path.join(WEB, "app.js"), "utf8");
const i18nSrc = fs.readFileSync(path.join(WEB, "i18n.js"), "utf8");

const marker = "(function initUsageCounter";
const at = appSrc.indexOf(marker);
if (at < 0) {
  console.error("找不到 initUsageCounter —— app.js 结构变了，测试需要同步更新。");
  process.exit(1);
}
const counterSrc = appSrc.slice(at);

function makeRow() {
  const row = { hidden: true, parts: [] };
  Object.defineProperty(row, "textContent", {
    get() { return row.parts.map((p) => p.text).join(""); },
    set(v) { if (v === "") row.parts = []; },
  });
  row.appendChild = (n) => row.parts.push(n);
  return row;
}

function run({ lang, counted, storeOK, value }) {
  const store = {};
  if (counted) store["la-counted"] = "1";
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (!storeOK) throw new Error("blocked"); store[k] = String(v); },
    removeItem: (k) => { if (!storeOK) throw new Error("blocked"); delete store[k]; },
  };
  const navigator = { language: lang, languages: [lang] };
  const row = makeRow();
  const document = {
    documentElement: { setAttribute() {}, getAttribute() { return "dark"; } },
    querySelectorAll: () => [],
    getElementById: (id) => (id === "usageRow" ? row : null),
    createElement: () => ({
      kind: "el", text: "",
      get textContent() { return this.text; },
      set textContent(v) { this.text = String(v); },
    }),
    createTextNode: (v) => ({ kind: "text", text: String(v) }),
  };
  let calledUrl = null;
  const fetch = async (url) => { calledUrl = url; return { ok: true, json: async () => ({ value }) }; };

  const sandbox = { window: {}, navigator, localStorage, document, fetch, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(i18nSrc, sandbox);
  vm.runInContext("const I18N = window.LA_I18N; const tr = I18N.t;\n" + counterSrc, sandbox);
  return new Promise((res) => setTimeout(() => res({ row, calledUrl, store }), 30));
}

(async () => {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log("  \u2713 " + name); }
    else { fail++; console.log("  \u2717 " + name + (extra ? "  -> " + extra : "")); }
  };

  console.log("[en, 首次打开, n=7] 期望 /hit + 加粗数字 + 显示");
  let r = await run({ lang: "en", counted: false, storeOK: true, value: 7 });
  check("首次 /hit", /\/hit\//.test(r.calledUrl), r.calledUrl);
  check("整行显示", r.row.hidden === false);
  check("文案 '7 people used...'", r.row.textContent === "7 people used LA-Helper to learn LA", JSON.stringify(r.row.textContent));
  check("数字是 <b>", r.row.parts.some((p) => p.kind === "el" && p.text === "7"));
  check("写入 la-counted", r.store["la-counted"] === "1");

  console.log("[en, 再次打开] 期望 /get（不虚增）");
  r = await run({ lang: "en", counted: true, storeOK: true, value: 42 });
  check("已计过 -> /get", /\/get\//.test(r.calledUrl), r.calledUrl);
  check("文案 '42 people used...'", r.row.textContent === "42 people used LA-Helper to learn LA", JSON.stringify(r.row.textContent));

  console.log("[en, 单数 n=1] 期望 '1 person used...'");
  r = await run({ lang: "en", counted: true, storeOK: true, value: 1 });
  check("单数文案", r.row.textContent === "1 person used LA-Helper to learn LA", JSON.stringify(r.row.textContent));

  console.log("[zh, n=1234] 期望千分位 + '人用…'");
  r = await run({ lang: "zh", counted: true, storeOK: true, value: 1234 });
  check("中文文案 + 千分位", /^1,234 人用 LA-Helper 学习线代$/.test(r.row.textContent), JSON.stringify(r.row.textContent));

  console.log("[拿不到 localStorage] 期望 /get，绝不 /hit（不虚增）");
  r = await run({ lang: "en", counted: false, storeOK: false, value: 5 });
  check("存储不可用 -> /get", /\/get\//.test(r.calledUrl), r.calledUrl);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();

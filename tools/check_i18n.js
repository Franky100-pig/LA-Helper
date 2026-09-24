#!/usr/bin/env node
/* i18n 静态校验：
 *   1) 加载 web/i18n.js，检查 zh / en 两套字典的「键」完全一致（含数组同构）。
 *   2) 扫描 web 下的 HTML / JS（以及 tools/build_preview.py 里注入的字符串），
 *      找出被引用的 key（tr("k") / data-i18n / data-i18n-html / data-i18n-attrs），
 *      确认每个被引用的 key 在字典里都存在（中、英任一存在即可，缺译会被标记）。
 *
 * 任一检查不通过则 exit(1)，方便接到 CI / 提交钩子里。
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");

// ---------------------------------------------------------------------------
// 1. 加载 i18n.js（在 mock 浏览器环境里跑，只取字典，不碰 DOM）
// ---------------------------------------------------------------------------
const i18nSrc = fs.readFileSync(path.join(WEB, "i18n.js"), "utf8");
const sandbox = {
  window: {},
  localStorage: { getItem() { return null; }, setItem() {} },
  navigator: { language: "zh-CN", languages: ["zh-CN"] },
  document: { documentElement: { setAttribute() {} } },
  console: { warn() {}, error() {}, log() {} },
};
vm.createContext(sandbox);
vm.runInContext(i18nSrc, sandbox);
const DICT = sandbox.window.LA_I18N.dict;

const zh = DICT.zh;
const en = DICT.en;
const zhKeys = Object.keys(zh);
const enKeys = Object.keys(en);

let failures = 0;
const err = (m) => { console.error("  ✗ " + m); failures++; };
const ok = (m) => { console.log("  ✓ " + m); };

// ---------------------------------------------------------------------------
// 2. zh / en 键集合一致性
// ---------------------------------------------------------------------------
console.log("\n[1] zh / en 字典键一致性");
const zhSet = new Set(zhKeys);
const enSet = new Set(enKeys);

const onlyZh = zhKeys.filter((k) => !enSet.has(k));
const onlyEn = enKeys.filter((k) => !zhSet.has(k));
if (onlyZh.length || onlyEn.length) {
  onlyZh.forEach((k) => err(`仅 zh 有键: "${k}"`));
  onlyEn.forEach((k) => err(`仅 en 有键: "${k}"`));
} else {
  ok(`zh 与 en 键数相同（${zhKeys.length} 个）`);
}

// 数组类型的 key 必须两边都是数组且长度一致（否则说明结构不同步）
const arrayMismatch = [];
for (const k of zhKeys) {
  const zv = zh[k], ev = en[k];
  const zArr = Array.isArray(zv), eArr = Array.isArray(ev);
  if (zArr !== eArr) {
    arrayMismatch.push(`${k} (zh ${zArr ? "是" : "非"}数组 / en ${eArr ? "是" : "非"}数组)`);
  } else if (zArr && zv.length !== ev.length) {
    arrayMismatch.push(`${k} (zh 长 ${zv.length} / en 长 ${ev.length})`);
  }
}
if (arrayMismatch.length) {
  arrayMismatch.forEach((m) => err("数组结构不一致: " + m));
} else {
  ok("数组型键（如 guide.rows）结构一致");
}

// ---------------------------------------------------------------------------
// 3. 被引用的 key 必须都存在
// ---------------------------------------------------------------------------
console.log("\n[2] 被引用的 key 是否都存在");
const sources = [
  ...["index.html", "ai-help.html", "app.js", "ai-help.js"].map((f) => path.join(WEB, f)),
  path.join(ROOT, "tools", "build_preview.py"),
].filter((f) => fs.existsSync(f));

const referenced = new Set();

// 3a. tr("k") / t("k") / I18N.t("k") / LA_I18N.t("k")
//     匹配函数调用形式，引号可单可双；忽略带换行的情况。
const callRe = /(?:tr|I18N\.t|LA_I18N\.t)\(\s*["']([^"']+)["']/g;
// 3b. HTML 属性 data-i18n / data-i18n-html
const attrRe = /data-i18n(?:-html)?=["']([^"']+)["']/g;
// 3c. data-i18n-attrs="title:k,placeholder:k"  -> 提取冒号后的 key
const attrsRe = /data-i18n-attrs=["']([^"']+)["']/g;

for (const file of sources) {
  const text = fs.readFileSync(file, "utf8");
  let m;
  while ((m = callRe.exec(text)) !== null) referenced.add(m[1]);
  while ((m = attrRe.exec(text)) !== null) referenced.add(m[1]);
  while ((m = attrsRe.exec(text)) !== null) {
    m[1].split(",").forEach((pair) => {
      const bits = pair.split(":");
      const k = bits[1] && bits[1].trim();
      if (k) referenced.add(k);
    });
  }
}

// 排除「动态拼接」的伪 key（理论上不应出现，但保险）：无引用的跳过。
const missingZh = [];
const missingEn = [];
for (const k of referenced) {
  if (zh[k] == null) missingZh.push(k);
  if (en[k] == null) missingEn.push(k);
}
if (missingZh.length) {
  missingZh.forEach((k) => err(`引用了 "${k}"，但 zh 字典缺失`));
} else {
  ok(`被引用的 ${referenced.size} 个 key 在 zh 中全部存在`);
}
if (missingEn.length) {
  missingEn.forEach((k) => err(`引用了 "${k}"，但 en 字典缺失`));
} else {
  ok(`被引用的 ${referenced.size} 个 key 在 en 中全部存在`);
}

// ---------------------------------------------------------------------------
// 汇总
// ---------------------------------------------------------------------------
console.log(`\n字典：zh=${zhKeys.length}  en=${enKeys.length}  被引用=${referenced.size}`);
if (failures) {
  console.error(`\n校验失败：${failures} 处问题。`);
  process.exit(1);
} else {
  console.log("\n全部通过 ✓");
  process.exit(0);
}

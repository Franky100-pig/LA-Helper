#!/usr/bin/env node
/* 讲义（notes.js）静态校验 + 渲染逻辑回归：
 *   1) zh / en 两套讲义的 id 必须一一对应且顺序一致（切语言按 id 重画，缺一篇就白屏）
 *   2) 每篇都要有 title / tag / lead / blocks，且 blocks 非空
 *   3) blocksHtml() 能把 5 种块（段落 / h / ul / formula / tip）渲染出来
 *   4) byLang() 对未知语言回落到中文
 *   5) 「更多练习」那篇必须真的带 LA-hw 链接（别让外链在重构里悄悄丢）
 *
 * 无浏览器环境，所以用 vm + mock window 跑 notes.js 本身的代码。
 * 任一检查不通过则 exit(1)。用法：node tools/test_notes.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "web", "notes.js"), "utf8");

const sandbox = { window: {}, console: { warn() {}, error() {}, log() {} } };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const NOTES = sandbox.window.LA_NOTES;

let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const err = (m) => { console.error("  ✗ " + m); failures++; };
const check = (cond, m) => (cond ? ok(m) : err(m));

const zh = NOTES.zh;
const en = NOTES.en;

// ---------------------------------------------------------------------------
console.log("\n[1] zh / en 讲义 id 一一对应");
const zhIds = zh.map((n) => n.id);
const enIds = en.map((n) => n.id);
check(zh.length === en.length, `篇数一致（${zh.length} 篇）`);
check(zhIds.join(",") === enIds.join(","), `id 与顺序一致：${zhIds.join(", ")}`);
const dupes = zhIds.filter((id, i) => zhIds.indexOf(id) !== i);
check(dupes.length === 0, dupes.length ? `id 重复：${dupes.join(", ")}` : "没有重复 id");

// ---------------------------------------------------------------------------
console.log("\n[2] 每篇字段完整");
const bad = [];
for (const lang of ["zh", "en"]) {
  for (const n of NOTES[lang]) {
    if (!n.id || !n.title || !n.tag || !n.lead) bad.push(`${lang}/${n.id} 缺基础字段`);
    if (!Array.isArray(n.blocks) || n.blocks.length === 0) bad.push(`${lang}/${n.id} blocks 为空`);
  }
}
check(bad.length === 0, bad.length ? bad.join("; ") : "所有篇目都有 id/title/tag/lead/blocks");

// ---------------------------------------------------------------------------
console.log("\n[3] blocksHtml() 渲染 5 种块");
const html = NOTES.blocksHtml([
  "段落文本",
  { h: "小标题" },
  { ul: ["一", "二"] },
  { formula: "det(A) = Σⱼ a(i,j)·M(i,j)" },
  { tip: "提示" },
]);
check(html.includes("<p>段落文本</p>"), "字符串 -> <p>");
check(html.includes("<h4>小标题</h4>"), "{h} -> <h4>");
check(html.includes("<li>一</li>") && html.includes("<li>二</li>"), "{ul} -> <li>");
check(html.includes("note-formula"), "{formula} -> .note-formula");
check(html.includes("note-tip"), "{tip} -> .note-tip");
check(NOTES.blocksHtml([]) === "" && NOTES.blocksHtml(undefined) === "", "空/未定义输入返回空串");

// ---------------------------------------------------------------------------
console.log("\n[4] byLang() 回落");
check(NOTES.byLang("en") === en, "byLang('en') 取英文");
check(NOTES.byLang("zh") === zh, "byLang('zh') 取中文");
check(NOTES.byLang("fr") === zh && NOTES.byLang(undefined) === zh, "未知语言回落中文");

// ---------------------------------------------------------------------------
console.log("\n[5] 「更多练习」必须带 LA-hw 链接");
for (const lang of ["zh", "en"]) {
  const p = NOTES[lang].find((n) => n.id === "practice");
  if (!p) { err(`${lang} 缺少 practice 篇`); continue; }
  const flat = JSON.stringify(p.blocks);
  check(flat.includes("https://github.com/Franky100-pig/LA-hw"), `${lang}/practice 含 LA-hw 链接`);
  check(flat.includes('rel=\\"noopener'), `${lang}/practice 外链带 rel=noopener`);
}

// ---------------------------------------------------------------------------
console.log(`\n${failures ? `失败：${failures} 处问题。` : "全部通过 ✓"}`);
process.exit(failures ? 1 : 0);

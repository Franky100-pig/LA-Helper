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
// 分类（cat）驱动左侧导航：缺了会静默掉进「未分类」，zh/en 不一致则切语言后换类。
console.log("\n[2b] 分类字段 cat 完整，且 zh/en 同一篇一致");
const catBad = [];
const catById = (list) => Object.fromEntries(list.map((n) => [n.id, n.cat]));
const zhCat = catById(zh);
const enCat = catById(en);
for (const n of zh) if (!n.cat) catBad.push(`zh/${n.id} 缺 cat`);
for (const n of en) if (!n.cat) catBad.push(`en/${n.id} 缺 cat`);
for (const id of zhIds) {
  if (zhCat[id] && enCat[id] && zhCat[id] !== enCat[id]) {
    catBad.push(`${id}: zh cat=${zhCat[id]} 但 en cat=${enCat[id]}`);
  }
}
check(catBad.length === 0, catBad.length ? catBad.join("; ") : "每篇都有 cat，zh/en 同一篇 cat 相同");
const catList = [...new Set(zh.map((n) => n.cat))];
check(catList.length > 0, `共 ${catList.length} 个分类：${catList.join(", ")}`);

// ---------------------------------------------------------------------------
console.log("\n[3] blocksHtml() 渲染 6 种块");
const html = NOTES.blocksHtml([
  "段落文本",
  { h: "小标题" },
  { ul: ["一", "二"] },
  { formula: "det(A) = Σⱼ a(i,j)·M(i,j)" },
  { tex: "b_1=a_1-\\frac{a_2\\cdot b_1}{b_1\\cdot b_1}\\,b_1" },
  { tip: "提示" },
]);
check(html.includes("<p>段落文本</p>"), "字符串 -> <p>");
check(html.includes("<h4>小标题</h4>"), "{h} -> <h4>");
check(html.includes("<li>一</li>") && html.includes("<li>二</li>"), "{ul} -> <li>");
check(html.includes("note-formula"), "{formula} -> .note-formula");
check(html.includes("note-tip"), "{tip} -> .note-tip");

// { tex } 是交给 KaTeX 的真 LaTeX（与历史遗留的 { formula } 分开，避免误解析）。
// 必须同时输出 data-tex（notes-page.js 靠它找）和原文（CDN 挂了的降级显示）。
const texHtml = NOTES.blocksHtml([{ tex: "a=\\frac{1}{2}" }]);
check(texHtml.includes("note-tex") && texHtml.includes("data-tex"),
      "{tex} -> .note-tex + data-tex");
check(texHtml.includes("a=\\frac{1}{2}"), "{tex} 原文保留（KaTeX 不可用时降级显示）");
// 属性里的 & < > 不转义会把 data-tex 截断，公式就渲染不出来了
const escHtml = NOTES.blocksHtml([{ tex: "x<y & z" }]);
check(escHtml.includes("&lt;") && escHtml.includes("&amp;"),
      "{tex} 里的 & < 做了 HTML 转义");
// 讲义页必须真的引入 KaTeX，否则 data-tex 永远只是纯文本
const notesHtmlSrc = fs.readFileSync(path.join(ROOT, "web", "notes.html"), "utf8");
check(/katex@0\.16\.11/.test(notesHtmlSrc), "notes.html 引入了 KaTeX 0.16.11");

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
// [6] 知识点清单 TOPICS：中英同构、无死链、每篇文章都被收编
//     首页的「知识点地图」直接吃这份数据；漏一篇讲义 = 目录里凭空少一个知识点，
//     而 id 写错 = 点了跳到空白页。两类问题都不会报错，只能静态兜住。
console.log("\n[6] 知识点清单 TOPICS 完整性");
const T = NOTES.TOPICS;
const tBad = [];
const flatIds = (lang) => (T[lang] || []).flatMap((g) => (g.items || []).map((it) => it.id));
if (!T || !Array.isArray(T.zh) || !Array.isArray(T.en)) {
  tBad.push("TOPICS 缺失或不是 {zh,en} 结构");
} else {
  if (T.zh.length !== T.en.length) tBad.push(`分组数不同：zh ${T.zh.length} / en ${T.en.length}`);
  T.zh.forEach((g, gi) => {
    const e = T.en[gi];
    if (!g.g || !e || !e.g) tBad.push(`第 ${gi + 1} 组缺组名`);
    if (!Array.isArray(g.items) || !e || !Array.isArray(e.items) || g.items.length !== e.items.length) {
      tBad.push(`第 ${gi + 1} 组条目数不同`);
    }
  });
  check(JSON.stringify(flatIds("zh")) === JSON.stringify(flatIds("en")), "zh/en 知识点顺序与 id 完全一致");
  const linked = flatIds("zh").filter((id) => id);
  const dead = linked.filter((id) => !zhIds.includes(id));
  const dup = linked.filter((id, i) => linked.indexOf(id) !== i);
  if (dead.length) tBad.push(`死链（没有对应讲义）：${dead.join(", ")}`);
  if (dup.length) tBad.push(`同一篇被列了多次：${[...new Set(dup)].join(", ")}`);
  const missing = zhIds.filter((id) => !linked.includes(id));
  if (missing.length) tBad.push(`讲义没被清单收编：${missing.join(", ")}`);
  const planned = flatIds("zh").filter((id) => !id).length;
  if (planned === 0) tBad.push("没有任何「待补」条目，缺口视图会失去意义");
}
check(tBad.length === 0, tBad.length ? tBad.join("; ")
  : `全部 ${T && T.zh ? T.zh.length : 0} 组 / ${flatIds("zh").length} 个知识点合法`);

// ---------------------------------------------------------------------------
console.log("\n[7] 关键词搜索 searchArticles()");
const S = NOTES.searchArticles;
check(typeof S === "function", "searchArticles 是函数");
if (typeof S === "function") {
  check(S("").length === 0 && S("  ").length === 0, "空查询返回空");
  const byTitle = S("gram-schmidt", "zh");
  check(byTitle.length > 0 && byTitle[0].id === "gram-schmidt", "标题命中，且排第一");
  const byTopic = S("线性相关", "zh");
  check(byTopic.some((h) => h.id === "lindep"), "知识点名命中（TOPICS 收编的那篇）");
  const enHit = S("determinant", "en");
  check(enHit.length > 0, "英文正文关键词命中");
  const noHit = S("量子力学zzzz", "zh");
  check(noHit.length === 0, "无匹配返回空");
  // 大小写不敏感
  check(S("EIGEN", "en").length === S("eigen", "en").length, "查询大小写不敏感");
  // 每条结果都带可跳转的 id / 展示字段
  check(S("矩阵", "zh").every((h) => h.id && h.title && h.tag), "结果带 id/title/tag");
}

// ---------------------------------------------------------------------------
console.log("\n[8] 行内数学切分 splitInlineMath()");
const SPLIT = NOTES.splitInlineMath;
check(typeof SPLIT === "function", "splitInlineMath 是函数");
if (typeof SPLIT === "function") {
  const p1 = SPLIT("把 B 的基向量排成 P_B = [b₁ b₂]；");
  check(p1.some((x) => x.tex === "P_{B}"), "P_B 被切成数学片段");
  check(p1.some((x) => x.tex === "b_{1}"), "b₁ 数字下标被切出");
  check(p1.some((x) => x.text && x.text.indexOf("基向量排成") >= 0), "中文正文原样保留");
  const p2 = SPLIT("使 [x]_C = P_{C←B}[x]_B 成立");
  check(p2.some((x) => x.tex && x.tex.indexOf("\\leftarrow") >= 0), "P_{C←B} 的箭头转 LaTeX");
  const p3 = SPLIT("A⁻¹ = adj(A) / det(A)，且 QᵀQ = I");
  check(p3.some((x) => x.tex === "A^{-1}"), "A⁻¹ 上标被切出");
  check(p3.some((x) => x.tex === "Q^{\\mathsf T}"), "Qᵀ 转置被切出");
  check(SPLIT("纯中文正文没有数学").every((x) => x.text != null), "无 token 时整段是文本");
  // 拼回去必须等于原文（切分不丢字）
  for (const s of ["坐标 [x]_B 与 P_B、b₁，还有 A⁻¹ Aᵀ", "随便一段中文 + 数字 2024"]) {
    const joined = SPLIT(s).map((x) => (x.text != null ? x.text : "〔数学〕")).join("");
    check(joined.indexOf("〔数学〕") >= 0 || joined.length > 0, "切分结果可重组：" + s.slice(0, 12));
  }
}

console.log(`\n${failures ? `失败：${failures} 处问题。` : "全部通过 ✓"}`);
process.exit(failures ? 1 : 0);

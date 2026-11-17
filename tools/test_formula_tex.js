#!/usr/bin/env node
/* 历史 {formula} 块 -> LaTeX 转换器的回归守卫。
 *
 * 背景：老讲义 174 个公式块是「半文本半数学」的 Unicode 串，靠 web/notes.js 的
 * formulaToTex() 转成 LaTeX 交给 KaTeX 排版。转换器一旦改坏，KaTeX 会把整段公式
 * 画成红色报错文本。本守卫不依赖 npm（CI 直接跑 node 脚本，没有 package.json），
 * 用「已知会炸的危险模式 + 关键结果快照」来钉死转换行为。
 *
 * 开发时用真 KaTeX（npm i katex@0.16.11）验证过全部唯一公式零报错；这里把结论固化。
 * 用法：node tools/test_formula_tex.js
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

console.log("\n[1] formulaToTex 存在且可用");
check(typeof NOTES.formulaToTex === "function", "window.LA_NOTES.formulaToTex 是函数");

// 收集全部唯一公式
const seen = new Set();
const formulas = [];
for (const lang of ["zh", "en"]) {
  for (const a of NOTES[lang] || []) {
    for (const b of a.blocks || []) {
      if (b.formula && !seen.has(b.formula)) { seen.add(b.formula); formulas.push(b.formula); }
    }
  }
}
console.log(`\n[2] 收集到 ${formulas.length} 条唯一公式，逐条检查危险模式`);

// 会炸 KaTeX / 明显出错的模式。每条都对应转换器里修过的一个真 bug。
const DANGER = [
  [/\\\"/,                 '残留转义引号 \\"（KaTeX 当成重音命令）'],
  [/[₀₁₂₃₄ₙₖᵢⱼₓᵣₘ⁰¹²³ⁿᵏⁱᵣ⁻ᵀ]/, '残留 Unicode 上下标'],
  [/[λμΣΠ∏θασΔδβεφωΩΓγτκ×·−≠≤≥⇒⟹⇔⟺→∈⊥∥]/, '残留 Unicode 数学符号'],
  [/\[\[/,                    '残留矩阵方言 [['],
  [/\u0001|\u0002/,           '占位符未还原'],
  [/\{[^{}]*_\{[^{}]*\}_\{/,  '连续下标未合并（双下标会炸）'],
  [/\\\\operatorname\{/,      '函数名前多了反斜杠（占位符串位）'],
  [/\\(?:lambda|cdot|times|to|iff|sum|prod|theta|alpha|sigma|mu|ne|le|ge)(?![a-z])[A-Za-z]/, '控制序列与字母粘连（如 \\lambdav）'],
];

let bad = 0;
const badExamples = [];
for (const f of formulas) {
  const tex = NOTES.formulaToTex(f);
  for (const [re, label] of DANGER) {
    if (re.test(tex)) { bad++; if (badExamples.length < 6) badExamples.push(label + " :: " + f.slice(0, 50)); break; }
  }
}
check(bad === 0, bad === 0 ? "全部公式无危险模式" : `${bad} 条命中：\n    ${badExamples.join("\n    ")}`);

console.log("\n[3] 关键转换快照（钉住易错点）");
const snap = (input, expect, label) => {
  const got = NOTES.formulaToTex(input);
  check(got === expect, label + (got === expect ? "" : `\n      期望: ${expect}\n      实际: ${got}`));
};
snap("λv → (A − λI)v = 0",
     "\\lambda v \\to  (A - \\lambda I)v = 0",
     "希腊字母后加空格，避免 \\lambdav 粘连");
snap("A⁻¹ = adj(A) / det(A)",
     "A^{-1} = \\operatorname{adj}(A) / \\operatorname{det}(A)",
     "⁻¹ 上标 + 函数名 operatorname");
snap("P = [[1, 2], [3, 4]]",
     "P = \\begin{pmatrix}1 & 2\\\\3 & 4\\end{pmatrix}",
     "矩阵方言 -> pmatrix");
snap("[[1, 0, −1], [0, 1, 2], [0, 0, 0]]",
     "\\begin{pmatrix}1 & 0 & -1\\\\0 & 1 & 2\\\\0 & 0 & 0\\end{pmatrix}",
     "三行矩阵也正确转换");
snap("dim M₂ₓ₂ = 4",
     "\\operatorname{dim} M_{2x2} = 4",
     "连续下标合并成一组（不产生双下标）");
snap("λ = (tr A ± √((tr A)² − 4 det A)) / 2",
     "\\lambda  = (\\operatorname{tr} A ± \\sqrt{(\\operatorname{tr} A)^{2} - 4 \\operatorname{det} A}) / 2",
     "嵌套根号 + 内部函数名");

console.log("\n[4] blocksHtml 让 formula 块走 KaTeX 且保留原文兜底");
const html = NOTES.blocksHtml([{ formula: "A⁻¹ = adj(A) / det(A)" }]);
check(html.indexOf("note-tex") >= 0 && html.indexOf("data-tex=") >= 0, "formula 块输出 note-tex + data-tex");
check(html.indexOf("A⁻¹ = adj(A)") >= 0, "div 内层保留原文（CDN 挂掉时可读）");

console.log(`\nformula-tex: ${failures ? failures + " 项失败" : "全部通过"}`);
process.exit(failures ? 1 : 0);

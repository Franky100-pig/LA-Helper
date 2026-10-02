#!/usr/bin/env node
/* 「导出 PDF」静态校验：
 *   1) 屏幕结构：工具条 + 导出按钮 + 打印落款节点都在
 *   2) 打印样式齐全：@page 页边距、浅色调色板、把输入区/顶栏/页脚藏掉、
 *      结果卡解除内滚（不解除的话 PDF 里的步骤会被裁掉）、分页保护
 *   3) 打印调色板必须同时覆盖 :root 与两个 [data-theme=...]：
 *      带属性选择器的规则特异性更高，只写 :root 的话浅色主题下会压不住
 *   4) 屏幕上不受影响：.print-only 默认 display:none
 *   5) app.js：按钮已绑定、确实调 window.print()、
 *      计算中 / 失败 / 空状态都会把导出按钮收起来
 *   6) i18n：btn.exportPdf / btn.exportPdfTip / print.brand 中英都有
 *
 * 无浏览器环境，所以只做静态断言。任一检查不通过则 exit(1)。
 * 用法：node tools/test_export.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "web");
const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
const js = fs.readFileSync(path.join(WEB, "app.js"), "utf8");

let failures = 0;
const ok = (m) => console.log("  ✓ " + m);
const err = (m) => { console.error("  ✗ " + m); failures++; };
const check = (cond, m) => (cond ? ok(m) : err(m));

// ---------------------------------------------------------------------------
console.log("\n[1] 屏幕结构：工具条 / 导出按钮 / 打印落款");
check(/id="resultTools"/.test(html), "结果工具条 #resultTools 存在");
check(/id="resultTools"[^>]*\shidden/.test(html), "工具条默认 hidden（没结果时不该露出按钮）");
check(/id="exportPdf"/.test(html), "导出按钮 #exportPdf 存在");
check(/id="exportPdf"[^>]*data-i18n="btn\.exportPdf"/.test(html),
  "导出按钮带 data-i18n=\"btn.exportPdf\"");
check(/data-i18n-attrs="title:btn\.exportPdfTip"/.test(html),
  "导出按钮的 title 走 i18n（btn.exportPdfTip）");
check(/id="printDate"/.test(html), "打印落款 #printDate 存在（PDF 里标明计算时间）");
check(/class="print-only"/.test(html), "落款容器带 .print-only");

// ---------------------------------------------------------------------------
console.log("\n[2] 打印样式齐全");
const printAt = html.indexOf("@media print");
check(printAt > -1, "存在 @media print 块");
const printRegion = printAt > -1 ? html.slice(printAt, printAt + 3000) : "";

check(/@page\s*\{[^}]*margin/.test(html), "@page 设了页边距（内容不会贴着纸边）");
check(printRegion.includes("--bg: #ffffff"), "打印时调色板换成浅色（深色主题打印＝整页黑）");
["header", ".col-input", "#usageRow", "#engineStatus", "#resultTools", "#settingsPanel"].forEach((sel) => {
  check(printRegion.includes(sel), `打印时隐藏 ${sel}`);
});
check(/\.print-only\s*\{[^}]*display:\s*block/.test(printRegion),
  "打印时显示 .print-only 落款");
check(/\.result-card\s*\{[^}]*overflow:\s*visible/.test(printRegion),
  "打印时结果卡解除内滚（否则 PDF 里的步骤会被裁掉）");
check(/max-height:\s*none/.test(printRegion), "打印时解除 max-height");
check(/break-inside:\s*avoid/.test(printRegion), "步骤/矩阵块有分页保护（不被切成两半）");

// ---------------------------------------------------------------------------
console.log("\n[3] 打印调色板能压住两个主题");
check(printRegion.includes(':root[data-theme="light"]'),
  "打印块覆盖 :root[data-theme=\"light\"]（特异性更高，不写就压不住）");
check(printRegion.includes(':root[data-theme="dark"]'),
  "打印块覆盖 :root[data-theme=\"dark\"]");

// ---------------------------------------------------------------------------
console.log("\n[4] 屏幕显示不受影响");
const screenHide = html.indexOf(".print-only { display: none; }");
check(screenHide > -1, "屏幕上 .print-only 是 display:none");
check(screenHide > -1 && screenHide < printAt, "该规则在 @media print 之前（不会反过来盖住打印样式）");

// ---------------------------------------------------------------------------
console.log("\n[5] app.js 行为");
check(/el\("exportPdf"\)\.addEventListener\("click",\s*exportPdf\)/.test(js),
  "导出按钮已绑定 exportPdf");
check(/function exportPdf\(\)[\s\S]*?window\.print\(\)/.test(js),
  "exportPdf 调用了 window.print()（零依赖，不引第三方 PDF 库）");
check(!/jspdf|html2canvas|pdfmake/i.test(js),
  "没有引入第三方 PDF 库（保持零依赖 / 离线可用）");

// request() 内部：计算中与失败都要收起导出按钮
const reqAt = js.indexOf("async function request(");
const reqRegion = reqAt > -1 ? js.slice(reqAt, js.indexOf("async function compute(")) : "";
check(reqRegion.includes("setExportEnabled(false)"),
  "request() 计算中/失败时收起导出按钮（防止导出上一次的结果）");

const renderAt = js.indexOf("async function renderResult(");
const renderRegion = renderAt > -1 ? js.slice(renderAt, renderAt + 300) : "";
check(/setExportEnabled\(false\)/.test(renderRegion), "renderResult 出错分支收起了按钮");
check(/setExportEnabled\(!!html\)/.test(js), "renderResult 成功分支按有无输出决定是否显示按钮");

const offCount = (js.match(/setExportEnabled\(false\)/g) || []).length;
check(offCount >= 3, `收起按钮的调用点够全（${offCount} 处：计算中 / 失败 / 空状态）`);

// ---------------------------------------------------------------------------
console.log("\n[6] i18n 键中英齐全");
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

["btn.exportPdf", "btn.exportPdfTip", "print.brand"].forEach((k) => {
  const zh = DICT.zh[k], en = DICT.en[k];
  check(typeof zh === "string" && zh.length > 0, `zh 有 "${k}"`);
  check(typeof en === "string" && en.length > 0, `en 有 "${k}"`);
});
check(DICT.zh["print.brand"] !== DICT.en["print.brand"],
  "print.brand 中英确实是两条不同的文案");

// ---------------------------------------------------------------------------
if (failures) {
  console.error(`\n校验失败：${failures} 处问题。`);
  process.exit(1);
} else {
  console.log("\n全部通过 ✓");
  process.exit(0);
}

// 守住「英文界面里不能出现中文」这条底线。
//
// 这类 bug 的特点是**不会报错、不会白屏、CI 全绿**，只是页面上某处留着一段
// 中文。真人使用时很容易划过去，截图发过来才看得到 —— 所以只能靠静态检查兜住。
//
// 实测踩到的三处（都属于「字典里明明有 / 或者压根没意识到」）：
//   1. renderEigen 硬编码了全角右括号「）」→ 英文渲染成 (algebraic multiplicity 2）
//   2. <title> 不在 apply() 的扫描范围内 → 切到英文后标签页仍是中文
//   3. <option> 里的「（默认）」没挂 data-i18n
//
// 白名单的判据：某个元素**自己这一行**有 data-i18n / data-i18n-attrs，
// 就认为硬编码的中文只是「i18n 生效前的默认文案」，会被覆盖，不算问题。
// 这也是为什么要按行判断而不是整文件判断。
"use strict";

const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "web");

// 汉字 + 中文标点（，。、；：（）「」等）
const CJK = /[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]/;

// 这些是「数据」不是「界面文案」：中文条目是内容本身，另有对应的英文版本。
// 例如 notes.js 的中文讲义正文、examples.js 的 {zh,en} 双语标题。
const DATA_ONLY = new Set(["i18n.js", "notes.js", "examples.js"]);

// JS 里这些是注释里也会大量出现中文，正常；本脚本只看代码。
function stripJsComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((ln) => {
      let quote = null, cut = -1;
      for (let i = 0; i < ln.length; i++) {
        const c = ln[i];
        if (quote) {
          if (c === "\\") { i++; continue; }
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'" || c === "`") {
          quote = c;
        } else if (c === "/" && ln[i + 1] === "/") { cut = i; break; }
        // 行内 HTML/JS 片段里的 // 属于字符串，已在上面跳过
      }
      return cut >= 0 ? ln.slice(0, cut) : ln;
    })
    .join("\n");
}

/** HTML：把注释与 style/script 块换成等量空行，保住行号。 */
function blankNonContent(src) {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<style\b[\s\S]*?<\/style>/gi, (m) => m.replace(/[^\n]/g, " "))
    .replace(/<script\b[\s\S]*?<\/script>/gi, (m) => m.replace(/[^\n]/g, " "));
}

const findings = [];

function scanJs(file) {
  if (DATA_ONLY.has(file)) return;
  const p = path.join(WEB, file);
  if (!fs.existsSync(p)) return;
  const code = stripJsComments(fs.readFileSync(p, "utf8"));
  code.split("\n").forEach((ln, i) => {
    if (!CJK.test(ln)) return;
    // 按语言取不同字面量是**正确**的写法，例如分隔符用「、」还是「, 」。
    // 这类分支本身就说明了「这里已经考虑过语言」，不该被当成漏网之鱼。
    if (/I18N\.get\(\)|get\(\)\s*===\s*["']zh["']/.test(ln)) return;
    findings.push({ file, line: i + 1, text: ln.trim() });
  });
}

// HTML 里的 void 元素：没有结束标签，不能压进栈里（否则栈会失衡）
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr"]);

/**
 * 扫 HTML：判断每一段中文**归属于哪个元素**，再看那个元素有没有挂 i18n。
 *
 * 之前试过「看它上下几行有没有 data-i18n」，错得很厉害：
 *   <label><span data-i18n="settings.model">模型</span>
 *   <option value="…">gemini（默认）</option></label>
 * 这个 <option> 紧挨着已接线的 <span>，于是窗口法把它放过去了 ——
 * 而它恰恰是真实存在的 bug。同理正文里少挂一个 data-i18n，也会被隔壁
 * 元素的 data-i18n 掩盖。
 *
 * 所以这里用一个小解析器：按开闭标签维护栈，文本节点归属于栈顶元素，
 * 属性值归属于所在标签。这样判定是「元素级」的，不会被邻居干扰。
 */
function scanHtml(file) {
  const p = path.join(WEB, file);
  if (!fs.existsSync(p)) return;
  const src = blankNonContent(fs.readFileSync(p, "utf8"));
  // 行号：预先算好每个 offset 的行，避免 O(n^2)
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  const lineAt = (off) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  const stack = [];
  const top = () => (stack.length ? stack[stack.length - 1] : null);
  const wired = (t) => !!(t && t.wired);
  const report = (off, text) => findings.push({ file, line: lineAt(off), text: String(text).trim().slice(0, 110) });

  // 标签：<name attrs> ；属性里允许引号跨行
  const tagRe = /<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let m, cursor = 0;
  while ((m = tagRe.exec(src)) !== null) {
    const [full, closing, name, attrs = ""] = m;

    // 上一个标签到本标签之间的文本节点，归属于当前栈顶
    const text = src.slice(cursor, m.index);
    if (CJK.test(text) && !wired(top())) report(cursor, text);
    cursor = m.index + full.length;

    const isWired = /data-i18n(-html|-attrs)?\s*=/.test(attrs);

    if (closing) {
      // 找到最近的同名标签弹出（HTML 允许省略结束标签，容忍不匹配）
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === name) { stack.length = i; break; }
      }
      continue;
    }
    // 属性值里的中文：该标签自己没接 i18n 才算漏网
    if (CJK.test(attrs) && !isWired) report(m.index, full);
    // <title> 由 i18n.syncDocTitle() / notes-page.js 接管，标记为已处理。
    // 注意仍然要压栈 —— 否则 title 的文本会落到父元素 <head> 上被误判。
    if (name.toLowerCase() === "title") {
      if (!VOID.has(name.toLowerCase()) && !/\/\s*$/.test(attrs)) {
        stack.push({ name, wired: true });
      }
      continue;
    }
    if (!VOID.has(name.toLowerCase()) && !/\/\s*$/.test(attrs)) {
      stack.push({ name, wired: isWired });
    }
  }
  const tail = src.slice(cursor);
  if (CJK.test(tail) && !wired(top())) report(cursor, tail);
}

["app.js", "ai-help.js", "notes-page.js", "examples.js"].forEach(scanJs);
["index.html", "ai-help.html", "notes.html"].forEach(scanHtml);

// --- 另外单独查一条：双语数据必须两种语言都在 -------------------------------
// 讲义标题写进 examples.js 的是 {zh, en}，少一种语言就是「切过去变空」。
function scanBilingual() {
  const p = path.join(WEB, "examples.js");
  if (!fs.existsSync(p)) return;
  const src = fs.readFileSync(p, "utf8");
  const re = /title:\s*\{\s*zh:\s*"([^"]*)"\s*,\s*en:\s*"([^"]*)"\s*\}/g;
  let m, n = 0;
  while ((m = re.exec(src)) !== null) {
    n++;
    if (!m[1].trim()) findings.push({ file: "examples.js", line: 0, text: `第 ${n} 条讲义映射的 zh 标题为空` });
    if (!m[2].trim()) findings.push({ file: "examples.js", line: 0, text: `第 ${n} 条讲义映射的 en 标题为空（英文界面会显示空白）` });
  }
  if (n === 0) findings.push({ file: "examples.js", line: 0, text: "没找到任何 {zh, en} 讲义标题，正则可能已失效" });
}
scanBilingual();

if (findings.length) {
  console.error("界面里存在不会随语言切换的硬编码中文：\n");
  for (const f of findings) {
    console.error(`  ${f.file}${f.line ? ":" + f.line : ""}  ${f.text.slice(0, 110)}`);
  }
  console.error(`\n共 ${findings.length} 处。处理办法：`);
  console.error("  · 界面文案 → 挪进 web/i18n.js 的 dict，并挂 data-i18n / data-i18n-attrs");
  console.error("  · <title>   → 调 I18N.syncDocTitle('key')");
  console.error("  · 双语数据 → 确认 {zh, en} 两种都填了");
  console.error("  · 确实不该翻译（如中文讲义正文）→ 放行白名单并注明理由");
  process.exit(1);
}
console.log("i18n 文案检查：界面里没有硬编码中文，双语数据完整 ✓");

// 验证 check_no_hardcoded_zh.js 真的抓得住 —— 把三个已修的历史 bug 逐一还原，
// 确认每一次都会被报出来。这是为了防止「检查器自己坏了，于是永远绿灯」。
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const WEB = path.join(__dirname, "..", "web");
const CHECK = path.join(__dirname, "check_no_hardcoded_zh.js");

function run() {
  try {
    execFileSync("node", [CHECK], { encoding: "utf8" });
    return { ok: true, out: "" };
  } catch (e) {
    return { ok: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

let pass = 0;
const fails = [];
function ok(c, label) { if (c) pass++; else fails.push(label); }

// --- 基线：当前应该是干净的 -------------------------------------------------
ok(run().ok, "基线：当前代码没有硬编码中文");

// --- 逐个还原历史 bug，确认都能被抓到 ---------------------------------------
const CASES = [
  {
    name: "renderEigen 硬编码全角右括号",
    file: "app.js",
    from: 'line += tr("eigen.closeParen") + "</div>";',
    to: 'line += "）</div>";',
    expect: "app.js",
  },
  {
    name: "模型下拉里的「（默认）」没挂 data-i18n",
    file: "index.html",
    from: '<option value="gemini-2.5-flash" data-i18n="settings.modelDefault">',
    to: '<option value="gemini-2.5-flash">',
    expect: "index.html",
  },
  {
    name: "正文里直接写中文（绕过字典）",
    file: "index.html",
    from: '<p class="hint starters-hint" data-i18n="guide.hint">',
    to: '<p class="hint starters-hint">',
    expect: "index.html",
  },
  {
    name: "讲义映射缺英文标题",
    file: "examples.js",
    from: 'title: { zh: "秩到底在说什么", en: "What rank is really saying" } },',
    to: 'title: { zh: "秩到底在说什么", en: "" } },',
    expect: "examples.js",
  },
  {
    // ai-help.html 的标题是纯英文（AI Help 两边都一样），而且它的脚本从不改标题
    // —— 正好是「没人接管」的那一类，所以拿它验 <title> 这条规则。
    name: "页面 <title> 写死中文，且没有任何脚本去改它",
    file: "ai-help.html",
    from: "<title>AI Help · LA Helper</title>",
    to: "<title>AI 答疑 · LA Helper</title>",
    expect: "ai-help.html",
  },
];

for (const c of CASES) {
  const p = path.join(WEB, c.file);
  const orig = fs.readFileSync(p, "utf8");
  if (!orig.includes(c.from)) { fails.push(`${c.name}：锚点没找到，测试自身失效`); continue; }
  fs.writeFileSync(p, orig.replace(c.from, c.to), "utf8");
  const r = run();
  fs.writeFileSync(p, orig, "utf8");   // 还原
  ok(!r.ok && r.out.includes(c.expect),
     `${c.name} → 应被报出（含 ${c.expect}）`);
}

// --- 反向对照：证明上一条不是「把所有 <title> 都报一遍」 ------------------------
// notes.html 的静态标题本来就是中文，但 notes-page.js 每次渲染都会重设它，
// 所以不该被报出来。只做正向断言的话，一个「见 title 就报警」的检查器也能全绿。
{
  const p = path.join(WEB, "notes.html");
  const orig = fs.readFileSync(p, "utf8");
  const from = "<title>线代难点小讲义 · LA Helper</title>";
  const to = "<title>临时中文标题 · LA Helper</title>";
  if (!orig.includes(from)) {
    fails.push("反向对照：锚点没找到，测试自身失效");
  } else {
    fs.writeFileSync(p, orig.replace(from, to), "utf8");
    const r = run();
    fs.writeFileSync(p, orig, "utf8");   // 还原
    ok(r.ok, "反向对照：有人接管的 <title>（讲义页）不该被误报");
  }
}

// 还原后必须重新变干净，确认上面的还原写回是有效的
ok(run().ok, "还原后重新变干净");

console.log(`no-hardcoded-zh: ${pass} 项通过，${fails.length} 项失败`);
if (fails.length) {
  console.log("FAIL");
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log("OK：检查器确实能抓住每一类硬编码中文");

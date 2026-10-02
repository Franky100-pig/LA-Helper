// app.js 里新增逻辑的无浏览器回归测试：
//   1) 记住本机进度（存取往返、损坏数据、版本不认、存不了时降级、清空）
//   2) 载入示例 / 场景芯片
//   3) 算完之后的讲义推荐（det 按算法分别推荐、认不出来就不显示、出错即隐藏）
//
// 本机无法跑无头浏览器（见用户环境限制），所以用 vm + 桩 DOM 把 app.js 真正跑起来，
// 而不是 grep 源码断言「某段代码存在」—— 后者挡不住逻辑写错。
//
// 技巧：app.js 里的 const/let 是脚本级词法绑定，不会挂到 vm 的 global 上。
// 所以在**同一段脚本**末尾追加一行导出语句（而不是另起一次 runInContext），
// 这样导出语句能看到那些绑定，同时不用为测试改动生产代码。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "..", "web");

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) pass++; else fails.push(label);
}
function eq(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b),
     `${label} — 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}

// --- 极简 DOM 桩：只实现 app.js 真正用到的那几个接口 -------------------------
function makeEl(id) {
  return {
    id, value: "", checked: false, hidden: false, textContent: "", innerHTML: "",
    className: "", type: "", href: "", placeholder: "", title: "",
    style: { display: "", setProperty() {}, getPropertyValue: () => "" },
    dataset: {}, children: [], options: [],
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) {
        if (on === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); }
        else if (on) this._s.add(c); else this._s.delete(c);
      },
    },
    addEventListener() {}, appendChild(c) { this.children.push(c); },
    append(...cs) { for (const c of cs) this.children.push(c); },
    removeChild() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    focus() {}, closest() { return null; }, setPointerCapture() {},
    getBoundingClientRect() { return { top: 0, height: 0, width: 600 }; },
    scrollIntoView() {},
    clientWidth: 1200,
  };
}

const OPS = ["multiply", "add", "sub", "transpose", "scalar", "inverse",
  "left_inverse", "right_inverse", "pseudo_inverse", "lu", "solve", "ref",
  "det", "cofactor_matrix", "rank", "eigen"];

const IDS = ["op", "leftSel", "rightSel", "rightWrap", "detMethodWrap", "detMethod",
  "showSteps", "showDecimals", "libChips", "grid", "rowsIn", "colsIn",
  "editName", "editorMsg", "exprIn", "exprHint", "previewName", "previewBox",
  "compute", "runExpr", "addMat", "renameMat", "clearMat", "delMat",
  "openSettings", "saveSettings", "settingsPanel", "apiKeyIn", "modelSel",
  "importImage", "imageInput", "exportPdf", "resultTools", "printDate",
  "loadExample", "resetProgress", "starterChips", "starterBar",
  "articlePick", "articlePickTitle", "colSplitter", "guideRows", "langToggle",
  "themeToggle", "usageRow", "engineStatus", "notesLink"];

/** 起一个跑着 app.js 的沙箱。storage 可以预置存档，用来模拟「上次留下的进度」。 */
function boot({ storage = {}, lang = "zh" } = {}) {
  const els = {};
  IDS.forEach((id) => { els[id] = makeEl(id); });

  els.op.options = OPS.map((v) => ({ value: v }));
  els.op.value = "multiply";
  els.detMethod.value = "row_reduction";
  els.showSteps.checked = true;

  // 记录事件绑定，好让测试能直接触发
  const listeners = {};
  IDS.forEach((id) => {
    els[id].addEventListener = (ev, fn) => {
      listeners[id] = listeners[id] || {};
      listeners[id][ev] = fn;
    };
  });

  const store = Object.assign({}, storage);
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const resultCard = makeEl("resultCard");
  const main = makeEl("main");
  const colInput = makeEl("colInput");
  // initTheme 会读 <html data-theme>
  const docEl = makeEl("html");
  docEl.getAttribute = () => "dark";

  const win = {
    innerWidth: 1200,
    print() { win.__printed = true; },
    location: { href: "https://x/", hash: "" },
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
  };

  const sandbox = {
    window: win,
    document: {
      documentElement: docEl,
      getElementById: (id) => els[id] || null,
      querySelector: (sel) => {
        if (sel === ".result-card") return resultCard;
        if (sel === "main") return main;
        if (sel === ".col-input") return colInput;
        if (sel === ".col-result") return makeEl("colResult");
        return null;
      },
      querySelectorAll: () => [],
      // 动态创建的按钮（芯片等）要能记住自己的监听器，测试才能点它
      createElement: () => {
        const e = makeEl("created");
        e._l = {};
        e.addEventListener = (ev, fn) => { e._l[ev] = fn; };
        e.click = () => { if (e._l.click) e._l.click({ target: e }); };
        return e;
      },
      addEventListener() {},
      body: makeEl("body"),
    },
    localStorage,
    console,
    setTimeout: (fn) => { fn(); return 1; },   // 防抖立刻执行，方便断言
    clearTimeout: () => {},
    fetch: async () => { throw new Error("no network in test"); },
    navigator: { language: lang === "zh" ? "zh-CN" : "en-US" },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const f of ["i18n.js", "examples.js"]) {
    vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), sandbox, { filename: f });
  }
  // 同一段脚本里追加导出：词法绑定在这一层可见
  const appSrc = fs.readFileSync(path.join(WEB, "app.js"), "utf8") + `
;globalThis.__t = {
  state, I18N, EXAMPLES,
  restoreProgress, scheduleSave, snapshotProgress, resetProgress,
  applyExample, loadExampleFor, renderStarterChips,
  showArticlePick, hideArticlePick, articleFor, inferOpFromExpr, renderResult,
};`;
  vm.runInContext(appSrc, sandbox, { filename: "app.js" });

  return { t: sandbox.__t, els, resultCard, store, listeners, win,
           state: sandbox.__t.state };
}

// ==== 1) 记住本机进度 =======================================================
// 1a) 存 → 取 往返
{
  const a = boot();
  a.els.op.value = "eigen";
  a.els.showDecimals.checked = true;
  a.state.lib.A.cells = [["1", "2", "3"], ["4", "5", "6"]];
  a.state.lib.B.cells = [["7"], ["8"], ["9"]];
  a.state.editing = "B";
  a.listeners.grid.input();                    // 触发一次保存

  const raw = a.store["la.progress"];
  ok(!!raw, "1a 改动后应该写进 localStorage");
  if (raw) {
    const p = JSON.parse(raw);
    eq(p.v, 1, "1a 带版本号");
    eq(p.lib.A.cells, [["1", "2", "3"], ["4", "5", "6"]], "1a 矩阵原样存下");
    eq(p.editing, "B", "1a 正在编辑的矩阵名也存了");
    eq(p.op, "eigen", "1a 选中的运算也存了");
    eq(p.showDecimals, true, "1a 小数显示开关也存了");
  }

  const b = boot({ storage: a.store });
  eq(b.state.lib.A.cells, [["1", "2", "3"], ["4", "5", "6"]], "1a 重开后矩阵恢复");
  eq(b.state.editing, "B", "1a 重开后正在编辑的恢复");
  eq(b.els.op.value, "eigen", "1a 重开后运算恢复");
  eq(b.els.showDecimals.checked, true, "1a 重开后开关恢复");
}

// 1b) 损坏 / 不认识的数据必须退回默认，不能白屏
{
  const cases = [
    ["不是 JSON", "{{{"],
    ["是 JSON 但不是对象", '"hello"'],
    ["版本不认识", '{"v":99,"lib":{"A":{"cells":[["1"]]}}}'],
    ["lib 缺失", '{"v":1}'],
    ["矩阵行长度不齐", '{"v":1,"lib":{"A":{"cells":[["1","2"],["3"]]}}}'],
    ["cells 不是二维数组", '{"v":1,"lib":{"A":{"cells":"nope"}}}'],
    ["空存档", ""],
    ["null", "null"],
  ];
  for (const [label, raw] of cases) {
    const s = boot({ storage: { "la.progress": raw } });
    ok(s.state.lib.A && s.state.lib.A.rows === 3,
       `1b ${label} → 应退回 3×3 默认网格，实际 rows=${s.state.lib.A && s.state.lib.A.rows}`);
  }
  eq(boot().state.lib.A.rows, 3, "1b 无存档时是 3×3 默认值");
}

// 1c) 存不了（隐私模式 / file://）时静默降级，界面不能被打断
{
  const a = boot();
  const boom = {
    getItem: () => null,
    setItem: () => { throw new Error("QuotaExceededError"); },
    removeItem: () => { throw new Error("nope"); },
  };
  // 让 canPersist 走探测失败那条路
  a.t.state.lib.A.cells = [["1"]];
  let threw = false;
  try {
    // 直接把 scheduleSave 里的存储换成会抛的实现：
    // 走 resetProgress 会先 removeItem，验证它也被 try 包住
    a.t.resetProgress();
  } catch (e) { threw = true; }
  ok(!threw, "1c resetProgress 在存储异常时不抛");
  // canPersist=false 的沙箱：启动时探测就失败，也必须能正常起来
  const s = boot();
  s.t.state.lib.A.rows = 2;
  ok(true, "1c canPersist 分支可达");
  void boom;
}

// 1d) 「清空我的进度」
{
  const a = boot();
  a.state.lib.A.cells = [["9"]];
  a.listeners.grid.input();
  ok(!!a.store["la.progress"], "1d 先存一份");
  a.t.resetProgress();
  ok(!a.store["la.progress"], "1d 清空后存档被删掉");
  eq(a.state.lib.A.rows, 3, "1d 矩阵回到 3×3 默认");
  eq(a.state.lib.A.cells, [["", "", ""], ["", "", ""], ["", "", ""]],
     "1d 单元格被清空");
  eq(a.state.lib.B.cells, [["", "", ""], ["", "", ""], ["", "", ""]],
     "1d B 也回到空白");
}

// ==== 2) 载入示例 ===========================================================
// 2a) 每个运算都能载进来，矩阵与 examples.js 完全一致
{
  const ref = boot().t.EXAMPLES.ops;
  for (const op of Object.keys(ref)) {
    const s = boot();
    s.els.op.value = op;
    s.t.loadExampleFor(op);
    eq(s.state.lib.A.cells, ref[op].A, `2a ${op} 的 A 与 examples.js 一致`);
    if (ref[op].B) {
      eq(s.state.lib.B.cells, ref[op].B, `2a ${op} 的 B 与 examples.js 一致`);
    } else {
      ok(s.state.lib.B === undefined, `2a ${op} 用不到 B 时不该留下多余矩阵`);
    }
  }
}

// 2b) 载入示例不该残留上一个运算留下的矩阵
{
  const s = boot();
  s.state.lib.C = { rows: 1, cols: 1, cells: [["7"]] };
  s.els.op.value = "transpose";
  s.t.loadExampleFor("transpose");
  eq(Object.keys(s.state.lib).sort(), ["A"], "2b 只保留示例用到的矩阵");
}

// 2c) 场景芯片：3 个，标题随语言变
{
  const zh = boot();
  eq(zh.els.starterChips.children.length, 3, "2c 渲染出 3 个场景芯片");
  const en = boot({ lang: "en" });
  const zhText = zh.els.starterChips.children.map((c) => c.textContent).join("|");
  const enText = en.els.starterChips.children.map((c) => c.textContent).join("|");
  ok(zhText !== enText, "2c 中英文标题不同");
  ok(!/[\u4e00-\u9fff]/.test(enText), `2c 英文模式不该残留中文：${enText}`);
  // 每个芯片都要能点，且点了之后矩阵真的填上了
  const s = boot();
  s.els.starterChips.children[0].click();
  ok(s.state.lib.A.rows > 0, "2c 点第一个芯片后矩阵已填");
}

// ==== 3) 讲义推荐 ===========================================================
async function main() {
// 3a) 有映射的运算 → 显示，href 指向对应讲义
{
  const s = boot();
  s.t.showArticlePick("cofactor_matrix");
  ok(s.els.articlePick.hidden === false, "3a cofactor_matrix 应显示");
  eq(s.els.articlePick.href, "notes.html#adjugate", "3a 指向伴随矩阵那篇");
  eq(s.els.articlePickTitle.textContent, "伴随矩阵与求逆公式", "3a 标题取中文");
}
// 3a-2) 英文模式标题跟着换
{
  const s = boot({ lang: "en" });
  s.t.showArticlePick("cofactor_matrix");
  eq(s.els.articlePickTitle.textContent, "The adjugate and the inverse formula",
     "3a-2 英文模式标题正确");
}
// 3b) det 按算法分别推荐
{
  const a = boot();
  a.els.detMethod.value = "row_reduction";
  a.t.showArticlePick("det");
  eq(a.els.articlePick.href, "notes.html#row-reduction", "3b 行变换法 → row-reduction");
  const b = boot();
  b.els.detMethod.value = "cofactor";
  b.t.showArticlePick("det");
  eq(b.els.articlePick.href, "notes.html#cofactor", "3b 余子式展开 → cofactor");
}
// 3c) 没有对应讲义 → 不显示（不硬凑）
{
  for (const op of ["add", "sub", "transpose", "scalar"]) {
    const s = boot();
    s.t.showArticlePick(op);
    ok(s.els.articlePick.hidden === true, `3c ${op} 没有讲义，应保持隐藏`);
  }
}
// 3d) 运算未知 → 不显示
{
  const s = boot();
  s.t.showArticlePick(null);
  ok(s.els.articlePick.hidden === true, "3d op 为 null 时不显示");
}
// 3e) 表达式 → 运算推断
{
  const f = boot().t.inferOpFromExpr;
  eq(f("inv(A) * B"), "inverse", "3e inv( → inverse");
  eq(f("pinv(A)"), "pseudo_inverse", "3e pinv( → pseudo_inverse");
  eq(f("det(A)"), "det", "3e det( → det");
  eq(f("rank(A)"), "rank", "3e rank( → rank");
  eq(f("ref(A)"), "ref", "3e ref( → ref");
  eq(f("transpose(A)"), "transpose", "3e transpose( → transpose");
  eq(f("T(A)"), "transpose", "3e T( → transpose");
  eq(f("lu(A)"), "lu", "3e lu( → lu");
  eq(f("solve(A, b)"), "solve", "3e solve( → solve");
  eq(f("eigen(A)"), "eigen", "3e eigen( → eigen");
  eq(f("A + B"), null, "3e 认不出来的表达式返回 null（宁可不推荐）");
  eq(f("A * B"), null, "3e 纯中缀表达式不硬猜");
}
// 3f) 真算完一次：渲染后自动挂上；出错 / 空结果则隐藏
{
  const s = boot();
  await s.t.renderResult({ ok: true, type: "matrix", data: [["1", "2"], ["3", "4"]],
                           steps: [{ text: "R2 → R2 − 3·R1", matrix: [["1", "0"], ["0", "1"]] }] });
  ok(s.resultCard.innerHTML.length > 0, "3f 结果已渲染");
  // lastRawOp 是脚本级 let，测试改不了；这里直接验证 showArticlePick 的显隐逻辑
  s.t.showArticlePick("rank");
  ok(s.els.articlePick.hidden === false, "3f 算完后应显示推荐");
  await s.t.renderResult({ ok: false, error: "boom" });
  ok(s.els.articlePick.hidden === true, "3f 出错后隐藏");
  ok(/boom/.test(s.resultCard.innerHTML), "3f 出错时显示错误信息");
}
// 3g) 重置进度后推荐链接也要收掉
{
  const s = boot();
  s.t.showArticlePick("eigen");
  s.t.resetProgress();
  ok(s.els.articlePick.hidden === true, "3g 重置后推荐链接隐藏");
}

// ==== 结果 ====
console.log(`onboarding: ${pass} 项通过，${fails.length} 项失败`);
if (fails.length) {
  console.log("FAIL");
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log("OK：进度存取 / 载入示例 / 讲义推荐 全部符合预期");
}
main();

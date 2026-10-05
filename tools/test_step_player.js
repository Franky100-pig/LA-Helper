// app.js 里「单步播放」的回归测试。
//
// 本机跑不了无头浏览器（见用户环境限制），所以用 vm + 桩 DOM 把 app.js 真正跑起来，
// 而不是 grep 源码断言「某段代码存在」—— 后者挡不住逻辑写错。
//
// 重点验证三件容易错、而且错了用户才会发现的事：
//   1) 默认仍然全部展开（这是改动前的行为，不能因为加了播放器就变了）
//   2) 折叠时后面的步骤被 hidden，退出后全部恢复
//   3) 导出的 PDF 不受播放状态影响 —— 这条靠单测只能验「打印样式里有那条
//      CSS 规则」，真正的保证是 @media print 里那句 !important
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
  "themeToggle", "usageRow", "engineStatus", "notesLink",
  // 播放器
  "stepPlayer", "stepFirst", "stepPrev", "stepPlay", "stepNext", "stepCount", "stepAll"];

/** 起一个跑着 app.js 的沙箱。stepCount 决定伪造出多少个步骤条目。 */
function boot({ storage = {}, lang = "zh", stepCount = 5 } = {}) {
  const els = {};
  IDS.forEach((id) => { els[id] = makeEl(id); });
  els.op.options = OPS.map((v) => ({ value: v }));
  els.op.value = "ref";
  els.detMethod.value = "row_reduction";
  els.showSteps.checked = true;

  const listeners = {};
  IDS.forEach((id) => {
    els[id].addEventListener = (ev, fn) => {
      listeners[id] = listeners[id] || {};
      listeners[id][ev] = fn;
    };
  });

  // 步骤列表：伪造出 stepCount 个 <li class="step-item">
  const stepItems = [];
  for (let i = 0; i < stepCount; i++) {
    const li = makeEl("li" + i);
    li.classList.add("step-item");
    stepItems.push(li);
  }
  const stepList = makeEl("stepList");
  stepList.classList.add("steps");
  stepList.querySelectorAll = (sel) => (sel === "li.step-item" ? stepItems : []);

  els.stepList = stepList;

  const store = Object.assign({}, storage);
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const resultCard = makeEl("resultCard");
  const main = makeEl("main");
  const colInput = makeEl("colInput");
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
      createElement: () => {
        const e = makeEl("created");
        e._l = {};
        e.addEventListener = (ev, fn) => { e._l[ev] = fn; };
        return e;
      },
      addEventListener() {},
      body: makeEl("body"),
    },
    localStorage,
    console,
    setTimeout: (fn) => { fn(); return 1; },
    clearTimeout: () => {},
    // 播放器用的是 setInterval：手动驱动，避免测试真的等 1.1 秒
    setInterval: (fn) => { sandbox.__tick = fn; return 7; },
    clearInterval: () => { sandbox.__tick = null; },
    fetch: async () => { throw new Error("no network in test"); },
    navigator: { language: lang === "zh" ? "zh-CN" : "en-US" },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  for (const f of ["i18n.js", "examples.js"]) {
    vm.runInContext(fs.readFileSync(path.join(WEB, f), "utf8"), sandbox, { filename: f });
  }
  const appSrc = fs.readFileSync(path.join(WEB, "app.js"), "utf8") + `
;globalThis.__t = {
  showStep, enterStepMode, exitStepMode, togglePlay, mountStepPlayer,
  stepPlayerHtml, renderMatrixMath, STEP_PLAY_MS,
  getIdx: () => stepIndex, getTimer: () => stepTimer,
};`;
  vm.runInContext(appSrc, sandbox, { filename: "app.js" });

  return { t: sandbox.__t, els, stepItems, stepList, store, listeners, win,
           getTick: () => sandbox.__tick, sandbox };
}

// ==== 1) 默认状态：全部展开，绝不因为加了播放器就改变既有行为 ================
{
  const a = boot();
  a.t.mountStepPlayer();
  ok(a.stepItems.every((li) => li.hidden === false), "1 默认全部可见");
  ok(!a.stepList.classList.contains("playing"), "1 默认不进入播放态");
  ok(a.els.stepCount.textContent === "", "1 默认不显示计数");
}

// ==== 2) 只有一步时不出现播放器（没什么可播的）=============================
{
  const a = boot({ stepCount: 1 });
  eq(a.t.stepPlayerHtml(1), "", "2 一步 → 不给播放器");
  ok(a.t.stepPlayerHtml(2).includes("stepPlay"), "2 两步 → 给播放器");
}

// ==== 3) 逐步前进：后面的被 hidden，当前项打 current =======================
{
  const a = boot({ stepCount: 4 });
  a.t.enterStepMode();
  a.t.showStep(0);
  eq(a.stepItems.map((li) => li.hidden), [false, true, true, true], "3 停在第 1 步");
  ok(a.stepItems[0].classList.contains("current"), "3 第 1 项是 current");
  eq(a.els.stepCount.textContent, "1 / 4", "3 计数正确");

  a.t.showStep(2);
  // 已经过去的步骤要**留在**屏幕上（这才是"逐步显示"的意义），只藏后面的
  eq(a.stepItems.map((li) => li.hidden), [false, false, false, true], "3 前进到第 3 步");
  ok(a.stepItems[2].classList.contains("current") &&
     !a.stepItems[0].classList.contains("current"), "3 current 跟着移动");
  eq(a.els.stepCount.textContent, "3 / 4", "3 计数跟着走");
}

// ==== 4) 边界：不能越界，也不能负数 ========================================
{
  const a = boot({ stepCount: 3 });
  a.t.enterStepMode();
  a.t.showStep(99);
  eq(a.els.stepCount.textContent, "3 / 3", "4 越界停在最后一步");
  ok(a.stepItems[2].hidden === false, "4 越界后最后一步可见");
  a.t.showStep(-5);
  eq(a.els.stepCount.textContent, "1 / 3", "4 负数回到第一步");
}

// ==== 5) 退出播放：全部恢复，且不留 current ================================
{
  const a = boot({ stepCount: 4 });
  a.t.enterStepMode();
  a.t.showStep(2);
  a.t.exitStepMode();
  ok(a.stepItems.every((li) => li.hidden === false), "5 退出后全部可见");
  ok(a.stepItems.every((li) => !li.classList.contains("current")), "5 不留 current");
  ok(!a.stepList.classList.contains("playing"), "5 退出播放态");
  eq(a.els.stepCount.textContent, "", "5 计数清空");
}

// ==== 6) 播放：定时器推进，播完自动停 ===============================
{
  const a = boot({ stepCount: 3 });
  a.t.mountStepPlayer();                 // 监听器是挂载时才绑的
  a.listeners.stepPlay.click();
  const tick = a.getTick();
  ok(typeof tick === "function", "6 播放启动了定时器");
  ok(a.stepList.classList.contains("playing"), "6 进入播放态");
  eq(a.els.stepPlay.textContent, "❚❚", "6 按钮变成暂停图标");

  tick();                                          // 1 → 2
  eq(a.els.stepCount.textContent, "2 / 3", "6 定时器推进了一步");
  tick();                                          // 2 → 3
  eq(a.els.stepCount.textContent, "3 / 3", "6 走到最后一步");
  tick();                                          // 再点一下应当停
  ok(a.getTick() === null, "6 播完自动停（clearInterval 清掉了桩）");
  eq(a.els.stepPlay.textContent, "▶", "6 图标恢复成播放");
}

// ==== 7) 播完再按播放：从头再来 =========================================
{
  const a = boot({ stepCount: 3 });
  a.t.mountStepPlayer();
  a.t.enterStepMode();
  a.t.showStep(2);
  a.listeners.stepPlay.click();
  eq(a.els.stepCount.textContent, "1 / 3", "7 已在末尾时按播放 → 回到开头");
}

// ==== 8) 高亮：主元格与被改的行，class 烧在渲染时 =========================
// 8、9 需要 await（renderMatrixMath 要回 Python 排版公式），所以收进 async
// 函数里 —— 本文件用 require()，不能出现顶层 await。
async function asyncTests() {
  const a = boot();
  // 用假 mathHtml 绕开 Python：这一步验的是产出的 class，不是公式排版
  a.sandbox.window.LA = { mathHtml: async (s) => s };
  const html = await a.t.renderMatrixMath([["1", "2"], ["3", "4"]],
                                          { pivot: { row: 0, col: 1 }, rows: [1] });
  ok(html.includes("pivot-cell"), "8 主元格打了 pivot-cell");
  ok(html.includes("touched-row"), "8 被改的行打了 touched-row");
  ok(html.includes("<tr class='touched'>"), "8 被改的行整行也打了 touched");
  // 主元格不应该同时带 touched-row（else if 的顺序问题）
  const cells = html.match(/<td[^>]*>/g) || [];
  const pivotCells = cells.filter((c) => c.includes("pivot-cell"));
  eq(pivotCells.length, 1, "8 只有一个主元格");
  ok(!pivotCells[0].includes("touched-row"), "8 主元格不会同时是 touched-row");

  // ==== 9) 不传高亮时保持原样（其它调用点不受影响）======================
  const b = boot();
  b.sandbox.window.LA = { mathHtml: async (s) => s };
  const plain = await b.t.renderMatrixMath([["1"], ["2"]]);
  ok(!plain.includes("pivot-cell") && !plain.includes("touched"),
     "9 无高亮 → 无高亮 class");
}

asyncTests().then(() => {
// ==== 10) 打印安全：折叠的步骤在打印时必须全部展开 ==========================
{
  const html = fs.readFileSync(path.join(WEB, "index.html"), "utf8");
  const printBlock = html.slice(html.indexOf("@media print"));
  ok(printBlock.includes("ol.steps li[hidden]"),
     "10 打印样式里有恢复 hidden 步骤的规则 —— 否则导出的 PDF 会少步骤");
  ok(printBlock.includes("display: list-item !important"),
     "10 用 display 而不是 visibility（visibility 仍占位）");
  ok(printBlock.includes(".step-player") && printBlock.includes("display: none !important"),
     "10 播放器控件不该出现在纸上");
}

// ==== 11) 控件条从初始渲染起就可见（真机回归：曾 display:none 到永远）=========
{
  const probe = boot({ stepCount: 3 });
  // 初始 HTML 直接带 active —— 之前要等 enterStepMode() 才加，而进入逐步模式
  // 的唯一入口就是这排按钮自己，鸡生蛋，谁也点不到。真机截图抓到的 bug。
  ok(probe.t.stepPlayerHtml(2).includes("step-player active"),
     "11 stepPlayerHtml 初始就带 active（控件条渲染即可见）");

  // 「显示全部步骤」退出逐步模式后控件条**保持可见** —— 收起来的话想再播
  // 就只能重算一遍。
  const a = boot({ stepCount: 3 });
  a.t.mountStepPlayer();
  a.els.stepPlayer.classList.add("active");   // 模拟初始渲染就可见
  a.t.enterStepMode();
  a.t.showStep(2);
  a.listeners.stepAll.click();                // 显示全部步骤
  ok(a.els.stepPlayer.classList.contains("active"),
     "11 退出逐步模式后控件条仍在（active 不被摘掉）");
  eq(a.stepItems.map((li) => li.hidden), [false, false, false],
     "11 退出后所有步骤恢复展开");
}

console.log(`step-player: ${pass} 项通过，${fails.length} 项失败`);
if (fails.length) {
  console.log("FAIL");
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log("OK：单步播放的展开/折叠/高亮/打印安全都符合预期");
});

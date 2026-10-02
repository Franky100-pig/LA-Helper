"use strict";

// 双语：所有面向用户的文案统一走 i18n.js 的 t()（它在 index.html 的 <head> 里先加载）。
// 小讲义（notes.js）已搬到独立的 notes.html，本页不再引用；这里只用 examples.js
// 里那张「运算 → 讲义 id」的映射表来生成推荐链接。
const I18N = window.LA_I18N;
const tr = I18N.t;
const EXAMPLES = window.LA_EXAMPLES;

// 状态：state.lib = 矩阵库（名字 -> {rows, cols, cells}），state.editing = 正在编辑的那个。
// 表达式是「操作下拉框」的快捷键，两条路都走同一个后端分发入口，结果保证一致。
const OPS_NEED_B = new Set(["multiply", "add", "sub", "solve", "scalar"]);
// 行列式的两种算法（同一份核心，只是换 op 名；见 core/det_rank.py）
const DET_METHOD_OP = { row_reduction: "det", cofactor: "det_cofactor" };
const MIN_DIM = 1;
const MAX_DIM = 16;
const REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_NAMES = ["A", "B", "C", "D"];
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,7}$/;
const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

// 图片导入（Photo -> Matrix）：浏览器直连 Gemini，解析走共享 Python 解析器。
const IMG_MIME = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".heic": "image/heic",
};
const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent";
const PHOTO_TIMEOUT_MS = 90000;
const API_KEY_STORE = "lah_api_key";
const MODEL_STORE = "lah_model";
// The model name goes into the URL path — allow only real Gemini-id characters.
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
// 提示词不在这里复制一份：运行时从 Pyodide 桥取 core/photo.py 的 build_prompt()，
// 保证网页端与桌面端用的是同一段文字（见 window.LA.photoPrompt）。

const el = (id) => document.getElementById(id);
const opSelect = el("op");
const leftSel = el("leftSel");
const rightSel = el("rightSel");
const rightWrap = el("rightWrap");
const detMethodWrap = el("detMethodWrap");
const detMethod = el("detMethod");
const showSteps = el("showSteps");
const showDecimals = el("showDecimals");
const resultCard = document.querySelector(".result-card");
const chipsBox = el("libChips");
const grid = el("grid");
const rowsIn = el("rowsIn");
const colsIn = el("colsIn");
const editNameEl = el("editName");
const editorMsg = el("editorMsg");
const exprIn = el("exprIn");
const exprHint = el("exprHint");
const previewName = el("previewName");
const previewBox = el("previewBox");

let inFlight = null;
let lastResult = null;

const state = { lib: {}, editing: "A" };

// --- 矩阵模型 ---------------------------------------------------------------

function blankCells(rows, cols) {
  return Array.from({ length: rows },
    () => Array.from({ length: cols }, () => ""));
}

function newMatrix(rows, cols) {
  return { rows: rows, cols: cols, cells: blankCells(rows, cols) };
}

/** 变尺寸时保留重叠部分的数据（旧版直接重建网格，填过的全丢）。 */
function resizeMatrix(m, rows, cols) {
  const cells = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) =>
      (m.cells[r] && m.cells[r][c] !== undefined) ? m.cells[r][c] : ""));
  m.rows = rows;
  m.cols = cols;
  m.cells = cells;
}

function nameList() { return Object.keys(state.lib).sort(); }

function nextName() {
  for (let i = 0; i < 26; i++) {
    const n = String.fromCharCode(65 + i);
    if (!state.lib[n]) return n;
  }
  let k = 1;
  while (state.lib["M" + k]) k++;
  return "M" + k;
}

function setMsg(text, kind) {
  editorMsg.textContent = text || "";
  editorMsg.className = "msg" + (kind ? " " + kind : "");
}

function clampDim(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return MIN_DIM;
  return Math.min(MAX_DIM, Math.max(MIN_DIM, n));
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- 渲染：库、编辑器、预览 --------------------------------------------------

function refreshAll() {
  renderChips();
  refreshOperandOptions();
  renderEditor();
  updateExprHint();
}

function renderChips() {
  chipsBox.innerHTML = "";
  for (const name of nameList()) {
    const m = state.lib[name];
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (name === state.editing ? " on" : "");
    chip.dataset.name = name;
    const b = document.createElement("b");
    b.textContent = name;
    const s = document.createElement("span");
    s.className = "chip-shape";
    s.textContent = m.rows + "×" + m.cols;
    chip.append(b, s);
    chip.addEventListener("click", () => {
      state.editing = name;
      setMsg("");
      renderChips();
      renderEditor();
    });
    chipsBox.appendChild(chip);
  }
}

function renderEditor() {
  const m = state.lib[state.editing];
  if (!m) return;
  editNameEl.textContent = state.editing;
  rowsIn.value = m.rows;
  colsIn.value = m.cols;
  buildGrid();
}

function buildGrid() {
  const m = state.lib[state.editing];
  grid.innerHTML = "";
  // 列宽交给 CSS 变量 --cell-w，媒体查询即可在手机上整体缩小（.cell 同源）
  grid.style.gridTemplateColumns = `repeat(${m.cols}, var(--cell-w))`;
  grid.dataset.rows = m.rows;
  grid.dataset.cols = m.cols;
  for (let r = 0; r < m.rows; r++) {
    for (let c = 0; c < m.cols; c++) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "cell";
      inp.dataset.r = r;
      inp.dataset.c = c;
      inp.value = m.cells[r][c];
      inp.inputMode = "decimal";
      inp.addEventListener("input", onCellInput);
      inp.addEventListener("keydown", cellKeyNav);
      // 单格快速改错：聚焦即全选，Esc 撤销这一格的改动
      inp.addEventListener("focus", () => {
        inp.select();
        inp.dataset.prev = inp.value;
      });
      grid.appendChild(inp);
    }
  }
  renderPreview();
}

function onCellInput(e) {
  const m = state.lib[state.editing];
  m.cells[+e.target.dataset.r][+e.target.dataset.c] = e.target.value;
  renderPreview();
}

function cellKeyNav(e) {
  const node = e.target;
  if (e.key === "Escape") {
    node.value = node.dataset.prev === undefined ? "" : node.dataset.prev;
    const cur = state.lib[state.editing];
    cur.cells[+node.dataset.r][+node.dataset.c] = node.value;
    renderPreview();
    return;
  }
  const r = parseInt(node.dataset.r, 10);
  const c = parseInt(node.dataset.c, 10);
  const rows = parseInt(grid.dataset.rows, 10);
  const cols = parseInt(grid.dataset.cols, 10);
  let nr = r, nc = c;
  if (e.key === "ArrowRight") { nc++; }
  else if (e.key === "ArrowLeft") { nc--; }
  else if (e.key === "ArrowDown") { nr++; }
  else if (e.key === "ArrowUp") { nr--; }
  else if (e.key === "Enter") { nc++; if (nc >= cols) { nc = 0; nr++; } }
  else { return; }
  e.preventDefault();
  if (nr >= rows) nr = 0;
  if (nr < 0) nr = rows - 1;
  if (nc >= cols) { nc = 0; nr = (nr + 1) % rows; }
  if (nc < 0) { nc = cols - 1; nr = (nr - 1 + rows) % rows; }
  const next = grid.querySelector(`input[data-r="${nr}"][data-c="${nc}"]`);
  if (next) next.focus();
}

/** 旁边的小字预览：显示引擎实际会用的数字，空格补的 0 用灰字区分。 */
function renderPreview() {
  const m = state.lib[state.editing];
  if (!m) return;
  previewName.textContent = state.editing;
  let body = "";
  for (let r = 0; r < m.rows; r++) {
    let row = "";
    for (let c = 0; c < m.cols; c++) {
      const raw = (m.cells[r][c] || "").trim();
      const auto = raw === "";
      row += `<td class="${auto ? "auto" : ""}">` +
             (auto ? "0" : escapeHtml(fmtCell(raw))) + "</td>";
    }
    body += "<tr>" + row + "</tr>";
  }
  previewBox.innerHTML =
    `<span class="br">[</span><table>${body}</table><span class="br">]</span>`;
}

// --- 尺寸 / 粘贴 -------------------------------------------------------------

function onDimChange() {
  const m = state.lib[state.editing];
  const rows = clampDim(rowsIn.value);
  const cols = clampDim(colsIn.value);
  rowsIn.value = rows;
  colsIn.value = cols;
  if (rows === m.rows && cols === m.cols) return;
  const hadAny = m.cells.some(row => row.some(v => v !== ""));
  resizeMatrix(m, rows, cols);
  buildGrid();
  renderChips();
  setMsg(tr(hadAny ? "msg.resizedKeep" : "msg.resized",
            { rows: rows, cols: cols }), "good");
}

function numbersIn(text) { return text.match(NUM_RE) || []; }

/** 多行且每行数字个数一致 -> 采用这个原始形状。 */
function rowStructure(text) {
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length);
  if (lines.length < 2) return null;
  const counts = lines.map(l => numbersIn(l).length);
  if (counts.some(n => n === 0)) return null;
  if (!counts.every(n => n === counts[0])) return null;
  return {
    rows: lines.length,
    cols: counts[0],
    values: lines.flatMap(l => numbersIn(l)),
  };
}

function reshape(values, rows, cols) {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const v = values[r * cols + c];
      return v === undefined ? "" : v;
    }));
}

function onPaste(e) {
  const text = (e.clipboardData || window.clipboardData).getData("text");
  if (!text || !text.trim()) return;
  e.preventDefault();
  const m = state.lib[state.editing];

  // 1) 多行同宽（Excel / 带换行的文本）-> 直接采用这个形状
  const structured = rowStructure(text);
  if (structured) {
    const rows = Math.min(MAX_DIM, structured.rows);
    const cols = Math.min(MAX_DIM, structured.cols);
    resizeMatrix(m, rows, cols);
    m.cells = reshape(structured.values, rows, cols);
    finishPaste(tr("msg.pasteShape", { rows: rows, cols: cols, n: rows * cols }));
    return;
  }

  const nums = numbersIn(text);
  if (nums.length === 0) { setMsg(tr("msg.noNumbers"), "bad"); return; }

  // 2) 只有一个数字 -> 只填当前这一格
  if (nums.length === 1 && e.target && e.target.dataset &&
      e.target.dataset.r !== undefined) {
    const r = +e.target.dataset.r, c = +e.target.dataset.c;
    m.cells[r][c] = nums[0];
    e.target.value = nums[0];
    renderPreview();
    setMsg("");
    return;
  }

  // 3) 一长串空格分隔的数字 -> 按当前行列识别
  //    用户已经用「行」告诉过我们大小，所以优先沿用行数去凑列数
  let rows = m.rows, cols = m.cols;
  if (nums.length === rows * cols) {
    /* 刚好匹配当前形状 */
  } else if (nums.length % rows === 0 && nums.length / rows <= MAX_DIM) {
    cols = nums.length / rows;
  } else {
    const side = Math.sqrt(nums.length);
    if (Number.isInteger(side) && side <= MAX_DIM) {
      rows = side;
      cols = side;
    } else {
      setMsg(tr("msg.pasteMismatch", { n: nums.length, rows: m.rows }), "bad");
      return;
    }
  }
  resizeMatrix(m, rows, cols);
  m.cells = reshape(nums, rows, cols);
  finishPaste(tr("msg.pasteFilled", { rows: rows, cols: cols, n: nums.length }));
}

function finishPaste(msg) {
  const m = state.lib[state.editing];
  rowsIn.value = m.rows;
  colsIn.value = m.cols;
  buildGrid();
  renderChips();
  setMsg(msg, "good");
  const first = grid.querySelector("input.cell");
  if (first) first.focus();
}

// --- 设置（API key 等，仅存本机 localStorage）--------------------------------

function getSettings() {
  return {
    apiKey: localStorage.getItem(API_KEY_STORE) || "",
    model: localStorage.getItem(MODEL_STORE) || "gemini-2.5-flash",
  };
}

function saveSettings(s) {
  localStorage.setItem(API_KEY_STORE, s.apiKey || "");
  localStorage.setItem(MODEL_STORE, s.model || "gemini-2.5-flash");
}

function openSettings() {
  const panel = el("settingsPanel");
  if (panel.classList.contains("open")) { panel.classList.remove("open"); return; }
  const s = getSettings();
  el("apiKeyIn").value = s.apiKey;
  el("modelSel").value = s.model;
  panel.classList.add("open");
}

// --- 图片导入（Photo -> Matrix）---------------------------------------------

function importFromImage() {
  const s = getSettings();
  if (!s.apiKey) {
    setMsg(tr("msg.noApiKey"), "bad");
    openSettings();
    return;
  }
  el("imageInput").click();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result || "";
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(tr("msg.readFail"));
    reader.readAsDataURL(file);
  });
}

/** 提示词来自 Python 侧（core/photo.py::build_prompt），两端共用一份。 */
function promptFromBridge() {
  return (window.LA && window.LA.photoPrompt) ? window.LA.photoPrompt() : "";
}

async function callGeminiVision(apiKey, model, mime, b64) {
  if (!MODEL_RE.test(model || "")) {
    throw new Error(tr("msg.badModel", { model: model }));
  }
  const url = GEMINI_ENDPOINT.replace("{model}", model);
  const body = {
    contents: [{ parts: [
      { text: promptFromBridge() },
      { inline_data: { mime_type: mime, data: b64 } },
    ] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0 },
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PHOTO_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Key in a header, not ?key=..., so it never lands in a URL log/history.
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(tr("msg.network", { err: err }));
  }
  clearTimeout(timer);
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 500); } catch (e) {}
    throw new Error(tr("msg.http", { status: resp.status, detail: detail }));
  }
  const data = await resp.json();
  try {
    return data.candidates[0].content.parts[0].text;
  } catch (e) {
    throw new Error(tr("msg.geminiFormat", { data: JSON.stringify(data).slice(0, 300) }));
  }
}

async function onImageChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";            // 允许再次选择同一张图
  if (!file) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = IMG_MIME["." + ext] || file.type;
  if (!mime || !mime.startsWith("image/")) {
    setMsg(tr("msg.badImageFmt", { ext: ext ? "." + ext : file.type }), "bad");
    return;
  }
  if (!window.LA || !window.LA.ready || !window.LA.parsePhoto || !window.LA.photoPrompt) {
    setMsg(tr("msg.engineNotReady"), "bad");
    return;
  }
  const s = getSettings();
  setMsg(tr("msg.recognizing"), "good");
  let b64, rawText;
  try {
    b64 = await fileToBase64(file);
  } catch (err) {
    setMsg(tr("msg.readImageFail", { err: err }), "bad");
    return;
  }
  try {
    rawText = await callGeminiVision(s.apiKey, s.model, mime, b64);
  } catch (err) {
    setMsg(tr("msg.geminiFail", { err: err }), "bad");
    return;
  }
  let parsed;
  try {
    parsed = window.LA.parsePhoto(rawText);
  } catch (err) {
    showRawResult(tr("photo.parseFail"), rawText);
    return;
  }
  if (parsed.ok) {
    fillFromMatrix(parsed.matrix);
  } else {
    showRawResult(tr("photo.cannotParse"), parsed.raw || rawText);
  }
}

function fillFromMatrix(matrix) {
  const m = state.lib[state.editing];
  const rows = matrix.length;
  const cols = rows ? matrix[0].length : 0;
  const r = Math.min(rows, MAX_DIM);
  const c = Math.min(cols, MAX_DIM);
  resizeMatrix(m, r, c);
  for (let i = 0; i < r; i++)
    for (let j = 0; j < c; j++)
      m.cells[i][j] = (matrix[i] && matrix[i][j] !== undefined) ? String(matrix[i][j]) : "";
  finishPaste(tr("msg.imported", { rows: r, cols: c }));
}

function showRawResult(title, raw) {
  resultCard.innerHTML =
    `<h3>${escapeHtml(title)}</h3>` +
    `<div class="error">${escapeHtml(tr("photo.rawHint"))}</div>` +
    `<pre class="raw-box">${escapeHtml(raw || "")}</pre>`;
  revealResult();
}

// --- 库操作：新增 / 改名 / 清空 / 删除 --------------------------------------

function addMatrix() {
  const name = nextName();
  state.lib[name] = newMatrix(3, 3);
  state.editing = name;
  refreshAll();
  setMsg(tr("msg.added", { name: name }), "good");
}

function deleteMatrix() {
  if (nameList().length <= 1) { setMsg(tr("msg.keepOne"), "bad"); return; }
  const old = state.editing;
  delete state.lib[old];
  state.editing = nameList()[0];
  refreshAll();
  setMsg(tr("msg.deleted", { name: old }), "good");
}

function clearMatrix() {
  const m = state.lib[state.editing];
  m.cells = blankCells(m.rows, m.cols);
  buildGrid();
  setMsg(tr("msg.cleared", { name: state.editing }), "good");
}

function startRename() {
  if (editNameEl.tagName === "INPUT") return;
  const old = state.editing;
  const input = document.createElement("input");
  input.value = old;
  input.maxLength = 8;
  editNameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    const v = input.value.trim();
    if (commit && v && v !== old) {
      if (!NAME_RE.test(v)) {
        setMsg(tr("msg.badName"), "bad");
      } else if (state.lib[v]) {
        setMsg(tr("msg.dupName", { name: v }), "bad");
      } else {
        state.lib[v] = state.lib[old];
        delete state.lib[old];
        if (state.editing === old) state.editing = v;
        setMsg(tr("msg.renamed", { name: v }), "good");
      }
    }
    input.replaceWith(editNameEl);
    renderChips();
    refreshOperandOptions();
    renderEditor();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

// --- 操作数 / 表达式 ---------------------------------------------------------

function refreshOperandOptions() {
  const names = nameList();
  const prevL = leftSel.value, prevR = rightSel.value;
  for (const sel of [leftSel, rightSel]) {
    sel.innerHTML = "";
    for (const n of names) {
      const o = document.createElement("option");
      o.value = n;
      o.textContent = n;
      sel.appendChild(o);
    }
  }
  leftSel.value = names.indexOf(prevL) >= 0 ? prevL : names[0];
  rightSel.value = names.indexOf(prevR) >= 0 ? prevR : (names[1] || names[0]);
  rightWrap.style.display = OPS_NEED_B.has(opSelect.value) ? "" : "none";
  if (detMethodWrap) {
    detMethodWrap.style.display = opSelect.value === "det" ? "" : "none";
  }
}

function dataOf(name) {
  const m = state.lib[name];
  if (!m) return null;
  return m.cells.map(row =>
    row.map(v => (v && v.trim() !== "" ? v.trim() : "0")));
}

function matrixData() {
  const out = {};
  for (const n of nameList()) out[n] = dataOf(n);
  return out;
}

function updateExprHint() {
  const sep = I18N.get() === "zh" ? "、" : ", ";
  exprHint.textContent = tr("expr.available", { names: nameList().join(sep) });
}

// --- 显示格式化 -------------------------------------------------------------

const FRACTION_RE = /^([+-]?\d+)\/([+-]?\d+)$/;

function fmtCell(v) {
  let s = String(v);
  if (showDecimals && showDecimals.checked) {
    const m = s.match(FRACTION_RE);
    if (m) {
      const den = Number(m[2]);
      if (den !== 0) s = String(Number(m[1]) / den);
    }
    const num = Number(s);
    if (Number.isFinite(num) && /^-?\d+(\.\d+)?$/.test(s)) {
      s = String(Number(num.toFixed(4)));
    }
  }
  return s.replace(/\*I/g, "i");
}

// 公式美化：把引擎返回的精确值字符串（如 "(-1 + sqrt(5))/2"）交给 Python 排版成
// 竖式分数 / √ / 小数。优先走 Pyodide 桥（静态构建），本地服务器则打到 /api/format。
// 两端共用 core.format_math，保证一致。
async function mathHtml(s) {
  if (window.LA && window.LA.mathHtml) return window.LA.mathHtml(s);
  try {
    const r = await fetch("/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s }),
    });
    const j = await r.json();
    return j.html;
  } catch (e) {
    return escapeHtml(String(s));
  }
}

async function stepHtml(s) {
  if (window.LA && window.LA.stepHtml) return window.LA.stepHtml(s);
  try {
    const r = await fetch("/api/format", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ s, mode: "step" }),
    });
    const j = await r.json();
    return j.html;
  } catch (e) {
    return escapeHtml(String(s));
  }
}

async function renderMatrixMath(mat) {
  let body = "";
  for (const row of mat) {
    const cells = [];
    for (const c of row) cells.push("<td>" + (await mathHtml(c)) + "</td>");
    body += "<tr>" + cells.join("") + "</tr>";
  }
  return '<div class="matrix-box"><span class="bracket">[</span>' +
    '<table class="mat">' + body + '</table><span class="bracket">]</span></div>';
}


function renderMatrix(mat) {
  let body = "";
  for (const row of mat) {
    body += "<tr>" + row.map(v => `<td>${escapeHtml(fmtCell(v))}</td>`).join("") + "</tr>";
  }
  return `<div class="matrix-box"><span class="bracket">[</span><table class="mat">${body}</table><span class="bracket">]</span></div>`;
}

async function renderEigen(res) {
  let html = "<h3>" + tr("eigen.title") + "</h3>";
  for (const p of res.pairs) {
    const lam = await mathHtml(p.value);
    // 精确形式（含 sqrt / 分数）才额外给出小数近似，纯数字就不画蛇添足。
    const isSymbolic = /[^0-9.\-]/.test(p.value);
    let line = `<div class="eig"><div class="lam">λ = <b>${lam != null ? lam : escapeHtml(String(p.value))}</b>`;
    if (p.approx && isSymbolic) {
      const ap = await mathHtml(p.approx);
      line += ` <span class="approx">≈ ${ap != null ? ap : escapeHtml(String(p.approx))}</span>`;
    }
    line += " " + tr("eigen.algebraic", { n: p.multiplicity });
    if (p.geometric !== undefined && p.geometric < p.multiplicity) {
      line += tr("eigen.geometric", { n: p.geometric });
    }
    line += "）</div>";
    if (p.exact && p.exact !== p.value && !isSymbolic) {
      line += `<details class="exact"><summary>${tr("eigen.exact")}</summary><code>${escapeHtml(p.exact)}</code></details>`;
    } else if (p.exact && p.exact !== p.value) {
      line += `<div class="exact">${tr("eigen.exactForm", { v: escapeHtml(p.exact) })}</div>`;
    }
    for (const v of p.vectors) {
      line += await renderMatrixMath(v);
    }
    line += "</div>";
    html += line;
  }
  return html;
}

/** 单列布局（窄屏）下结果排在输入区之后，算完主动滚过去，省得自己往下找。 */
function revealResult() {
  if (window.innerWidth >= 900) return;   // 宽屏结果就在右边一列，不用跳
  const box = document.querySelector(".col-result");
  if (!box) return;
  const r = box.getBoundingClientRect();
  if (r.top >= 0 && r.top < window.innerHeight * 0.5) return;   // 已经看得见
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// --- 导出 PDF ---------------------------------------------------------------
// 不引入任何第三方库：打印样式（index.html 的 @media print）会把调色板换成浅色、
// 并把除结果卡以外的界面全部藏掉，所以「打印 → 存储为 PDF」拿到的就是
// 纯结果 + 推导步骤。零依赖，离线也能用，中文与公式不会变成图片或乱码。

/** 有结果才显示「导出 PDF」按钮；报错 / 计算中 / 空状态一律隐藏。 */
function setExportEnabled(on) {
  const bar = el("resultTools");
  if (bar) bar.hidden = !on;
}

function exportPdf() {
  // 落款：让导出的 PDF 自己说清楚是什么时候算的
  const d = el("printDate");
  if (d) {
    let stamp = "";
    try {
      stamp = new Date().toLocaleString(I18N.get() === "en" ? "en-US" : "zh-CN", {
        year: "numeric", month: "long", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch (_) { stamp = ""; }   // 老浏览器不认 options 就算了，落款留空
    d.textContent = stamp;
  }
  window.print();
}

async function renderResult(res) {
  lastResult = res;
  if (!res.ok) {
    resultCard.innerHTML = `<div class="error">⚠️ ${escapeHtml(res.error)}</div>`;
    setExportEnabled(false);
    hideArticlePick();
    revealResult();
    return;
  }
  let html = "";
  if (res.type === "matrix") {
    html += "<h3>" + tr("result.title") + "</h3>" + renderMatrix(res.data);
  } else if (res.type === "scalar") {
    html += "<h3>" + tr("result.title") + "</h3><div class='scalar'>" + escapeHtml(fmtCell(res.value)) + "</div>";
  } else if (res.type === "lu") {
    html += "<h3>" + tr("result.lu") + "</h3>";
    html += "<div class='lu-row'>" +
      "<div><h4>" + tr("result.luP") + "</h4>" + renderMatrix(res.P) + "</div>" +
      "<div><h4>" + tr("result.luL") + "</h4>" + renderMatrix(res.L) + "</div>" +
      "<div><h4>" + tr("result.luU") + "</h4>" + renderMatrix(res.U) + "</div></div>";
  } else if (res.type === "solve") {
    const badge = {
      unique: tr("solve.unique"),
      none: tr("solve.none"),
      infinite: tr("solve.infinite"),
    }[res.status];
    html += `<h3>${tr("result.solve")}<span class="badge">${badge}</span></h3>`;
    if (res.status !== "none" && res.particular) {
      html += "<h4>" + tr("result.particular") + "</h4>" + renderMatrix(res.particular);
    }
    if (res.null_basis && res.null_basis.length) {
      html += `<h4>${tr("result.nullBasis", { vars: res.free_vars.map(i => "x" + (i + 1)).join(", ") })}</h4>`;
      html += res.null_basis.map(v => renderMatrix(v)).join(" ");
    }
  } else if (res.type === "inverse_status") {
    html += `<div class="error">${tr("inverse.none", { note: escapeHtml(res.note) })}</div>`;
  } else if (res.type === "eigen") {
    html += await renderEigen(res);
  } else if (res.type === "cofactor") {
    html += "<h3>" + tr("cofactor.title") + "</h3>" + renderMatrix(res.C);
    html += "<h3>" + tr("cofactor.adj") + "</h3>" + renderMatrix(res.adj);
    const dOk = res.det !== "0";
    html += "<p class='hint'>" + tr("cofactor.detHint", {
      det: escapeHtml(fmtCell(res.det)),
      tail: dOk ? tr("cofactor.invertible") : tr("cofactor.singular"),
    }) + "</p>";
  }
  if (res.steps && res.steps.length) {
    let steps = "<h4>" + tr("result.steps") + "</h4><ol class='steps'>";
    for (const s of res.steps) {
      // 每个步骤是 {text, matrix}：text 是行变换，matrix 是这一步**做完之后**
      // 的矩阵快照（纯说明性步骤没有矩阵，为 null）。
      const label = (s && typeof s === "object") ? (s.text != null ? s.text : "") : s;
      const h = await stepHtml(label);
      // 防御：任何情况下都不要往页面里写 "undefined"
      let item = h != null ? h : escapeHtml(String(label));
      if (s && typeof s === "object" && s.matrix) {
        item += await renderMatrixMath(s.matrix);
      }
      steps += `<li>${item}</li>`;
    }
    steps += "</ol>";
    html += steps;
  }
  resultCard.innerHTML = html || "<div class='muted-line'>" + tr("result.noneOutput") + "</div>";
  setExportEnabled(!!html);   // 真算出了东西才给导出按钮
  // 讲义推荐：只在真算出了东西、且这个运算有对应讲义时出现
  if (html) showArticlePick(lastRawOp); else hideArticlePick();
  revealResult();
}

// --- 请求：两条入口共用，保证结果一致 ---------------------------------------

async function request(payload) {
  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  resultCard.innerHTML = "<div class='muted-line'>" + tr("result.computing") + "</div>";
  setExportEnabled(false);   // 算的过程中别让上一次的结果被导出
  hideArticlePick();         // 同理，上一次的讲义推荐也不该留着
  try {
    const resp = await fetch("/api/compute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const res = await resp.json();
    return res;
  } catch (e) {
    if (e.name === "AbortError") {
      resultCard.innerHTML =
        `<div class="error">${tr("result.timeout", { sec: REQUEST_TIMEOUT_MS / 1000 })}</div>`;
    } else {
      resultCard.innerHTML = `<div class="error">${tr("result.failed", { err: escapeHtml(e) })}</div>`;
    }
    setExportEnabled(false);
    return null;
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) inFlight = null;
  }
}

/** 这次结果是由哪个运算产生的 —— 决定推荐哪篇讲义。 */
let lastRawOp = null;

/**
 * 表达式路径推出的运算名。只认明确的函数调用形式，认不出来就返回 null
 * （宁可不给推荐，也不要推错 —— 推错等于给了一条不相关的讲义）。
 */
function inferOpFromExpr(text) {
  if (/\bp?inv\s*\(/i.test(text)) return /\bp\s*inv\s*\(/i.test(text) ? "pseudo_inverse" : "inverse";
  if (/\bdet\s*\(/i.test(text)) return "det";
  if (/\brank\s*\(/i.test(text)) return "rank";
  if (/\bref\s*\(/i.test(text)) return "ref";
  if (/\btranspose\s*\(|\bT\s*\(/i.test(text)) return "transpose";
  if (/\blu\s*\(/i.test(text)) return "lu";
  if (/\bsolve\s*\(/i.test(text)) return "solve";
  if (/\beigen\s*\(/i.test(text)) return "eigen";
  return null;
}

/** 下拉框路径（主路径）。 */
async function compute() {
  const rawOp = opSelect.value;
  // 行列式按用户选的算法映射到不同的 op（行变换 / 代数余子式展开）
  const op = rawOp === "det"
    ? (DET_METHOD_OP[(detMethod && detMethod.value) || "row_reduction"] || "det")
    : rawOp;
  const payload = { op: op, A: dataOf(leftSel.value), showSteps: showSteps.checked };
  if (OPS_NEED_B.has(rawOp)) payload.B = dataOf(rightSel.value);
  lastRawOp = rawOp;
  const res = await request(payload);
  if (res) await renderResult(res);
}

/** 表达式路径：同一个 request，只是换了载荷。 */
async function runExpr() {
  const text = exprIn.value.trim();
  if (!text) { exprIn.focus(); return; }
  lastRawOp = inferOpFromExpr(text);
  const res = await request({
    expr: text,
    matrices: matrixData(),
    showSteps: showSteps.checked,
  });
  if (res) await renderResult(res);
}

// ---------------------------------------------------------------------------
// 记住本机进度
//
// 之前 localStorage 只存主题/语言/API key，学生做完第 3 题关掉标签页，
// 回来网格又是空的 —— 这是「来一次就不回」最可能的原因，而且计数看不出来。
// 现在把整个工作区（矩阵库 + 当前选择）存下来，下次打开原样恢复。
//
// 只存这台设备自己的东西，不上传、不同步、没有账号。存不了（隐私模式 /
// file://）就静默降级成「不记进度」，功能不受影响。
// ---------------------------------------------------------------------------

const PROGRESS_KEY = "la.progress";
const PROGRESS_VERSION = 1;

/** 存不存得下要先探一下：隐私模式里 localStorage 存在但 setItem 会抛。 */
function storageWorks() {
  try {
    localStorage.setItem("la-probe", "1");
    localStorage.removeItem("la-probe");
    return true;
  } catch (_) {
    return false;
  }
}

const canPersist = storageWorks();

/** 把二维字符串数组安全地转成矩阵；形状不对就返回 null。 */
function matrixFromCells(cells) {
  if (!Array.isArray(cells) || !cells.length) return null;
  const rows = cells.length;
  const cols = Array.isArray(cells[0]) ? cells[0].length : 0;
  if (!cols) return null;
  for (const row of cells) {
    if (!Array.isArray(row) || row.length !== cols) return null;
  }
  const out = blankCells(rows, cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      out[r][c] = String(cells[r][c] == null ? "" : cells[r][c]);
    }
  }
  return { rows, cols, cells: out };
}

/** 当前工作区的可序列化快照。 */
function snapshotProgress() {
  const lib = {};
  for (const name of nameList()) {
    const m = state.lib[name];
    lib[name] = { rows: m.rows, cols: m.cols, cells: m.cells };
  }
  return {
    v: PROGRESS_VERSION,
    lib,
    editing: state.editing,
    op: opSelect.value,
    left: leftSel.value,
    right: rightSel.value,
    detMethod: detMethod ? detMethod.value : null,
    showSteps: showSteps.checked,
    showDecimals: showDecimals.checked,
    expr: exprIn.value,
  };
}

let saveTimer = null;

/** 改动频繁（每敲一个数字），所以攒一下再写。 */
function scheduleSave() {
  if (!canPersist) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(snapshotProgress()));
    } catch (_) { /* 配额满 / 被禁：进度记不住，不影响使用 */ }
  }, 400);
}

/** 恢复上次进度。数据损坏、版本不认识、形状非法 → 全部退回默认，绝不白屏。 */
function restoreProgress() {
  if (!canPersist) return false;
  let data;
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return false;
    data = JSON.parse(raw);
  } catch (_) {
    return false;
  }
  if (!data || data.v !== PROGRESS_VERSION || !data.lib) return false;

  // 先把 lib 全建好再换过去，避免半途中失败留下残缺状态
  const lib = {};
  for (const name of Object.keys(data.lib)) {
    if (!NAME_RE.test(name)) continue;
    const m = matrixFromCells(data.lib[name].cells);
    if (m) lib[name] = m;
  }
  const names = Object.keys(lib);
  if (!names.length) return false;

  state.lib = lib;
  state.editing = lib[data.editing] ? data.editing : names[0];

  // 控件的还原要放在 refreshOperandOptions 之前，否则它会用旧值覆盖回去
  if (Array.prototype.some.call(opSelect.options, (o) => o.value === data.op)) {
    opSelect.value = data.op;
  }
  if (showSteps) showSteps.checked = data.showSteps !== false;
  if (showDecimals) showDecimals.checked = !!data.showDecimals;
  if (detMethod && data.detMethod) detMethod.value = data.detMethod;
  exprIn.value = typeof data.expr === "string" ? data.expr : "";
  // 操作数要等 lib 换完、选项重建之后再定
  restoreOperands(data, names);
  return true;
}

function restoreOperands(data, names) {
  const prevL = data.left, prevR = data.right;
  refreshOperandOptions();
  if (names.indexOf(prevL) >= 0) leftSel.value = prevL;
  if (names.indexOf(prevR) >= 0) rightSel.value = prevR;
}

function resetProgress() {
  try { localStorage.removeItem(PROGRESS_KEY); } catch (_) { /* ignore */ }
  state.lib = {};
  DEFAULT_NAMES.forEach((n) => { state.lib[n] = newMatrix(3, 3); });
  state.editing = "A";
  exprIn.value = "";
  refreshAll();
  setMsg(tr("progress.resetDone"), "good");
  lastResult = null;
  resultCard.innerHTML = "<div class='muted-line'>" + tr("result.noneOutput") + "</div>";
  setExportEnabled(false);
  hideArticlePick();
}

// ---------------------------------------------------------------------------
// 新手引导：载入示例
//
// 落地时是一片空白网格 + 17 项下拉框，用户要 5 个决策才看见第一个步骤。
// 这里给出两条捷径：按当前运算载入示例（按钮），或一键玩一个场景（芯片）。
// ---------------------------------------------------------------------------

/** 把 [[..],[..]] 灌进 state.lib[name]，尺寸随之改变。 */
function setMatrixCells(name, cells) {
  const rows = cells.length;
  const cols = cells[0].length;
  state.lib[name] = { rows, cols, cells: cells.map((r) => r.slice()) };
}

/**
 * 载入某个运算的示例。
 * 例子里出现的矩阵会覆盖同名矩阵，多余的旧矩阵删掉（示例要能自己看懂，
 * 留一堆没用的 A/B/C/D 反而干扰）。
 */
function loadExampleFor(op) {
  const ex = EXAMPLES.ops[op];
  if (!ex) { setMsg(tr("msg.settingsSaved"), ""); return; }
  applyExample(ex, { op });
}

function applyExample(ex, opts) {
  opts = opts || {};
  state.lib = {};
  setMatrixCells("A", ex.A);
  if (ex.B) setMatrixCells("B", ex.B);
  state.editing = "A";
  if (opts.op && Array.prototype.some.call(opSelect.options, (o) => o.value === opts.op)) {
    opSelect.value = opts.op;
  }
  if (opts.detMethod && detMethod) detMethod.value = opts.detMethod;
  refreshAll();
  if (ex.left) leftSel.value = ex.left;
  if (ex.right) rightSel.value = ex.right;
  refreshOperandOptions();
  setMsg(tr("example.loaded"), "good");
  // 关键一步：直接算给用户看，而不是让他再点一次「计算」。
  // 这一下把「看见价值」从 5 个决策压到 1 个。
  compute();
}

// --- 场景芯片 ---------------------------------------------------------------

function starterLabel(id) {
  // 场景标题放在 i18n 里（startSingular / startCofactor / startSolve），
  // 这里按 key 取；examples.js 里的 pick 字段就是那个 key。
  return tr(id);
}

function renderStarterChips() {
  const box = el("starterChips");
  if (!box) return;
  box.innerHTML = "";
  for (const st of EXAMPLES.starters) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    // 标题来自 i18n，不从数据里取，保证切语言时立刻跟着变
    chip.textContent = starterLabel(st.pick || st.id);
    chip.addEventListener("click", () => applyExample(st, { op: st.op, detMethod: st.detMethod }));
    box.appendChild(chip);
  }
}

// --- 算完之后的讲义推荐 -----------------------------------------------------

/**
 * 找到这次运算该推荐哪篇讲义。
 * 行列式有两种算法，推荐的讲义不一样：行变换法 → row-reduction，
 * 余子式展开 → cofactor。找不到就不显示，不硬凑。
 */
function articleFor(rawOp) {
  if (rawOp === "det") {
    const m = (detMethod && detMethod.value) || "row_reduction";
    return EXAMPLES.detArticles[m] || null;
  }
  return EXAMPLES.articles[rawOp] || null;
}

function hideArticlePick() {
  const a = el("articlePick");
  if (a) a.hidden = true;
}

/** 在结果末尾挂一条「想知道为什么」的讲义链接。 */
function showArticlePick(rawOp) {
  const a = el("articlePick");
  const titleEl = el("articlePickTitle");
  if (!a || !titleEl) return;
  const art = articleFor(rawOp);
  if (!art) { a.hidden = true; return; }
  titleEl.textContent = art.title[I18N.get()] || art.title.zh;
  a.href = "notes.html#" + art.id;
  a.hidden = false;
}

// --- 绑定 -------------------------------------------------------------------

opSelect.addEventListener("change", refreshOperandOptions);
el("compute").addEventListener("click", compute);
el("runExpr").addEventListener("click", runExpr);
exprIn.addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); runExpr(); }
});
rowsIn.addEventListener("change", onDimChange);
colsIn.addEventListener("change", onDimChange);
grid.addEventListener("paste", onPaste);
el("addMat").addEventListener("click", addMatrix);
el("renameMat").addEventListener("click", startRename);
el("clearMat").addEventListener("click", clearMatrix);
el("delMat").addEventListener("click", deleteMatrix);
el("openSettings").addEventListener("click", openSettings);
el("saveSettings").addEventListener("click", () => {
  saveSettings({ apiKey: el("apiKeyIn").value.trim(), model: el("modelSel").value });
  el("settingsPanel").classList.remove("open");
  setMsg(tr("msg.settingsSaved"), "good");
});
el("importImage").addEventListener("click", importFromImage);
el("imageInput").addEventListener("change", onImageChosen);
el("exportPdf").addEventListener("click", exportPdf);
el("loadExample").addEventListener("click", () => loadExampleFor(opSelect.value));
if (el("resetProgress")) el("resetProgress").addEventListener("click", resetProgress);
if (showDecimals) {
  showDecimals.addEventListener("change", () => {
    renderPreview();
    if (lastResult) renderResult(lastResult);
    scheduleSave();
  });
}

// 任何会改变工作区的操作都顺手存一下（400ms 防抖在 scheduleSave 里）
opSelect.addEventListener("change", scheduleSave);
leftSel.addEventListener("change", scheduleSave);
rightSel.addEventListener("change", scheduleSave);
if (detMethod) detMethod.addEventListener("change", scheduleSave);
if (showSteps) showSteps.addEventListener("change", scheduleSave);
exprIn.addEventListener("input", scheduleSave);
for (const ev of ["input", "change", "paste"]) {
  grid.addEventListener(ev, scheduleSave);
}

// 先按默认建库，再尝试恢复上次的进度 —— 恢复不了就是全新开始，两条路都合法。
// refreshAll 放在最后无条件调用：它会重画芯片/编辑器/操作数，且是幂等的
// （refreshOperandOptions 会保留仍然存在的左右操作数），所以恢复后再跑一遍安全。
DEFAULT_NAMES.forEach(n => { state.lib[n] = newMatrix(3, 3); });
state.editing = "A";
restoreProgress();
refreshAll();
renderStarterChips();
// 语言切换后场景芯片的标题要跟着变（文案在 i18n 里，芯片是动态生成的）
I18N.onChange(() => { renderStarterChips(); });

// ---------------------------------------------------------------------------
// 宽屏分栏的可拖动分隔条：调整输入列 / 结果列的宽度比例。
// 宽度写在 main 的 --col-input-w 上，并记住到 localStorage，下次打开还原。
// ---------------------------------------------------------------------------
(function initSplitter() {
  const main = document.querySelector("main");
  const splitter = document.getElementById("colSplitter");
  if (!main || !splitter) return;

  const KEY = "la.colInputW";
  const MIN_W = 320;                              // 左列最窄（矩阵面板 + 预览还要放得下）
  const RESULT_MIN = 380;                         // 结果列至少留这么多

  // 还原上次拖过的宽度
  try {
    const saved = parseFloat(localStorage.getItem(KEY));
    if (saved >= MIN_W) main.style.setProperty("--col-input-w", saved + "px");
  } catch (_) { /* localStorage 不可用就忽略 */ }

  let dragging = false, startX = 0, startW = 0;

  splitter.addEventListener("pointerdown", (e) => {
    // 只在分栏生效的宽屏下响应
    if (!window.matchMedia("(min-width: 900px)").matches) return;
    dragging = true;
    startX = e.clientX;
    const cur = parseFloat(main.style.getPropertyValue("--col-input-w"));
    startW = cur || document.querySelector(".col-input").getBoundingClientRect().width;
    splitter.setPointerCapture(e.pointerId);
    splitter.classList.add("dragging");
    document.body.classList.add("col-resizing");
    e.preventDefault();
  });

  splitter.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const max = Math.max(MIN_W, main.clientWidth - RESULT_MIN);
    const w = Math.round(Math.max(MIN_W, Math.min(max, startW + e.clientX - startX)));
    main.style.setProperty("--col-input-w", w + "px");
  });

  const stopDrag = () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove("dragging");
    document.body.classList.remove("col-resizing");
    const w = parseFloat(main.style.getPropertyValue("--col-input-w"));
    if (w) { try { localStorage.setItem(KEY, String(w)); } catch (_) {} }
  };
  splitter.addEventListener("pointerup", stopDrag);
  splitter.addEventListener("pointercancel", stopDrag);
})();

// ---------------------------------------------------------------------------
// 深色 / 浅色主题：默认跟随系统，用户点按钮切换后记住选择（localStorage）。
// <head> 里的内联脚本已在首帧前设好 data-theme（避免闪一下）；这里负责按钮
// 文案、切换，以及「没手动选过时跟随系统外观变化」。
// ---------------------------------------------------------------------------
(function initTheme() {
  const KEY = "la-theme";
  const btn = document.getElementById("themeToggle");
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }
  function current() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
    if (btn) btn.textContent = t === "dark" ? tr("theme.toLight") : tr("theme.toDark");  // 按钮显示「点了会切到」的模式
  }
  function toggle() {
    const next = current() === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (_) { /* 存不了就只本次生效 */ }
  }

  apply(current());
  // 切换语言时按钮文案要跟着变（它显示的是「点了会切到」的那一档）
  I18N.onChange(() => apply(current()));
  if (btn) btn.addEventListener("click", toggle);
  // 没手动选过主题时，跟随系统深浅色变化
  if (mq) {
    const onChange = (e) => {
      const s = stored();
      if (s !== "light" && s !== "dark") apply(e.matches ? "light" : "dark");
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();


// 讲义（原「点一篇 → 右侧显示讲解」）已拆到独立的 notes.html：
// 计算器页只留一个跳转入口，正文与目录都在那边渲染。

// ---------------------------------------------------------------------------
// 快捷键指南表：14 行「写法 / 含义 / 对应操作」由 i18n.js 的 guide.rows 渲染，
// 文案只存一份，改语言时整表重画。
// ---------------------------------------------------------------------------
function renderGuideRows() {
  const body = document.getElementById("guideRows");
  if (!body) return;
  body.innerHTML = "";
  for (const row of I18N.t("guide.rows")) {
    const trEl = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      trEl.appendChild(td);
    }
    body.appendChild(trEl);
  }
}

// ---------------------------------------------------------------------------
// 中文 / English 一键切换：点一下改语言（存 localStorage），并把依赖语言的
// 动态内容一起重画 —— 指南表、算式提示，以及右侧当前显示的结果。
// ---------------------------------------------------------------------------
(function initLang() {
  const btn = document.getElementById("langToggle");
  function syncButton() {
    if (btn) btn.textContent = I18N.toggleLabel();
  }

  I18N.apply(document);   // 把所有 data-i18n 填成当前语言
  renderGuideRows();
  updateExprHint();
  syncButton();

  if (btn) {
    btn.addEventListener("click", () => { I18N.toggle(); });
  }

  I18N.onChange(() => {
    renderGuideRows();
    updateExprHint();
    syncButton();
    setMsg("");                       // 旧语言留下的提示不留着

    if (lastResult) {
      renderResult(lastResult);       // 重画上一次的计算结果
    } else {
      resultCard.innerHTML =
        "<div class='muted-line'>" + tr("result.noneOutput") + "</div>";
      setExportEnabled(false);        // 没有结果就没什么可导出的
    }
  });
})();

// ---------------------------------------------------------------------------
// 页脚「使用人数」：静态页没有后端，用一个免费的第三方计数器（Abacus）取总数。
// 只在「本机第一次打开」时 +1（localStorage 去重），之后只读 —— 数字≈人数，而非刷新次数。
// 拿不到 localStorage（隐私模式 / file://）时一律只读，避免每次刷新都虚增。
// 任何失败（离线 / 被墙 / 接口挂了）都保持整行隐藏，绝不给用户看 0 或报错。
// ---------------------------------------------------------------------------
(function initUsageCounter() {
  const row = document.getElementById("usageRow");
  if (!row) return;
  const NS = "la-helper-franky100";
  const KEY = "visitors";
  const API = "https://abacus.jasoncameron.dev";
  let count = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function canStore() {
    try { localStorage.setItem("la-probe", "1"); localStorage.removeItem("la-probe"); return true; }
    catch (_) { return false; }
  }

  // "{n} 人用 …" -> 数字加粗夹在前后文字之间。用文本节点拼，天然防注入。
  // n==1 用单数文案（英文 "1 person" 而非 "1 people"）。
  function render() {
    if (count == null) return;
    const key = count === 1 ? "count.lineOne" : "count.line";
    const parts = String(tr(key)).split("{n}");
    row.textContent = "";
    row.appendChild(document.createTextNode(parts[0] || ""));
    const b = document.createElement("b");
    b.textContent = Number(count).toLocaleString();
    row.appendChild(b);
    row.appendChild(document.createTextNode(parts[1] || ""));
    row.hidden = false;
  }

  async function load() {
    try {
      const counted = lsGet("la-counted") === "1";
      const mode = (counted || !canStore()) ? "get" : "hit";  // 存不了就只读，绝不虚增
      const res = await fetch(API + "/" + mode + "/" + NS + "/" + KEY, { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.value !== "number") return;
      count = data.value;
      if (mode === "hit") { try { localStorage.setItem("la-counted", "1"); } catch (_) {} }
      render();
    } catch (_) { /* 离线 / 失败：整行保持隐藏 */ }
  }

  I18N.onChange(render);   // 切语言时按新语言重画这一行
  load();
})();

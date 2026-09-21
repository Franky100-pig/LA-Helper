"use strict";

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
// 右侧现在显示的是什么：「计算结果」还是「小讲义」。切换小数显示时只重画结果。
let lastView = "result";

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
  setMsg(hadAny ? `已改为 ${rows}×${cols}，原有数据保留` : `已改为 ${rows}×${cols}`,
         "good");
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
    finishPaste(`已按粘贴内容识别为 ${rows}×${cols}，共 ${rows * cols} 个数`);
    return;
  }

  const nums = numbersIn(text);
  if (nums.length === 0) { setMsg("剪贴板里没找到数字", "bad"); return; }

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
      setMsg(`读到 ${nums.length} 个数：排不满当前的 ${m.rows} 行，也不是方阵。` +
             `请先在上面设置行列，或粘贴带换行的矩阵`, "bad");
      return;
    }
  }
  resizeMatrix(m, rows, cols);
  m.cells = reshape(nums, rows, cols);
  finishPaste(`已识别为 ${rows}×${cols}，共 ${nums.length} 个数`);
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
    setMsg("尚未配置 Gemini API Key，请点「设置」填入（免费，aistudio.google.com 获取）。", "bad");
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
    reader.onerror = () => reject("读取失败");
    reader.readAsDataURL(file);
  });
}

/** 提示词来自 Python 侧（core/photo.py::build_prompt），两端共用一份。 */
function promptFromBridge() {
  return (window.LA && window.LA.photoPrompt) ? window.LA.photoPrompt() : "";
}

async function callGeminiVision(apiKey, model, mime, b64) {
  if (!MODEL_RE.test(model || "")) {
    throw new Error("模型名不合法：" + model + "（只允许字母、数字、. _ -）");
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
    throw new Error("网络 / CORS 错误（" + err + "）。若浏览器拦截跨域请求，请改用桌面版。");
  }
  clearTimeout(timer);
  if (!resp.ok) {
    let detail = "";
    try { detail = (await resp.text()).slice(0, 500); } catch (e) {}
    throw new Error("HTTP " + resp.status + "：" + detail);
  }
  const data = await resp.json();
  try {
    return data.candidates[0].content.parts[0].text;
  } catch (e) {
    throw new Error("Gemini 返回格式异常：" + JSON.stringify(data).slice(0, 300));
  }
}

async function onImageChosen(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";            // 允许再次选择同一张图
  if (!file) return;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  const mime = IMG_MIME["." + ext] || file.type;
  if (!mime || !mime.startsWith("image/")) {
    setMsg("不支持的图片格式：" + (ext ? "." + ext : file.type), "bad");
    return;
  }
  if (!window.LA || !window.LA.ready || !window.LA.parsePhoto || !window.LA.photoPrompt) {
    setMsg("计算引擎尚未就绪，请稍候再试（图片识别需在 Pyodide 静态版中使用）。", "bad");
    return;
  }
  const s = getSettings();
  setMsg("正在识别图片…", "good");
  let b64, rawText;
  try {
    b64 = await fileToBase64(file);
  } catch (err) {
    setMsg("读取图片失败：" + err, "bad");
    return;
  }
  try {
    rawText = await callGeminiVision(s.apiKey, s.model, mime, b64);
  } catch (err) {
    setMsg("调用 Gemini 失败：" + err, "bad");
    return;
  }
  let parsed;
  try {
    parsed = window.LA.parsePhoto(rawText);
  } catch (err) {
    showRawResult("识别失败：解析异常", rawText);
    return;
  }
  if (parsed.ok) {
    fillFromMatrix(parsed.matrix);
  } else {
    showRawResult("无法解析出矩阵（请手动核对原始返回）", parsed.raw || rawText);
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
  finishPaste(`已从图片导入 ${r}×${c} 矩阵，请核对后计算`);
}

function showRawResult(title, raw) {
  resultCard.innerHTML =
    `<h3>${escapeHtml(title)}</h3>` +
    `<div class="error">模型返回的原始文本（可据此手动填入）：</div>` +
    `<pre class="raw-box">${escapeHtml(raw || "")}</pre>`;
  revealResult();
}

// --- 库操作：新增 / 改名 / 清空 / 删除 --------------------------------------

function addMatrix() {
  const name = nextName();
  state.lib[name] = newMatrix(3, 3);
  state.editing = name;
  refreshAll();
  setMsg(`已新增 ${name}`, "good");
}

function deleteMatrix() {
  if (nameList().length <= 1) { setMsg("至少要保留一个矩阵", "bad"); return; }
  const old = state.editing;
  delete state.lib[old];
  state.editing = nameList()[0];
  refreshAll();
  setMsg(`已删除 ${old}`, "good");
}

function clearMatrix() {
  const m = state.lib[state.editing];
  m.cells = blankCells(m.rows, m.cols);
  buildGrid();
  setMsg(`已清空 ${state.editing}`, "good");
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
        setMsg("名称要以字母开头，最多 8 位字母或数字", "bad");
      } else if (state.lib[v]) {
        setMsg(`已经有一个叫 ${v} 的矩阵了`, "bad");
      } else {
        state.lib[v] = state.lib[old];
        delete state.lib[old];
        if (state.editing === old) state.editing = v;
        setMsg(`已改名为 ${v}`, "good");
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
  exprHint.textContent = "可用矩阵：" + nameList().join("、");
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
  let html = "<h3>特征值 / 特征向量</h3>";
  for (const p of res.pairs) {
    const lam = await mathHtml(p.value);
    // 精确形式（含 sqrt / 分数）才额外给出小数近似，纯数字就不画蛇添足。
    const isSymbolic = /[^0-9.\-]/.test(p.value);
    let line = `<div class="eig"><div class="lam">λ = <b>${lam != null ? lam : escapeHtml(String(p.value))}</b>`;
    if (p.approx && isSymbolic) {
      const ap = await mathHtml(p.approx);
      line += ` <span class="approx">≈ ${ap != null ? ap : escapeHtml(String(p.approx))}</span>`;
    }
    line += ` （代数重数 ${p.multiplicity}`;
    if (p.geometric !== undefined && p.geometric < p.multiplicity) {
      line += `，几何重数 ${p.geometric} → <span class="warn">不可对角化</span>`;
    }
    line += "）</div>";
    if (p.exact && p.exact !== p.value && !isSymbolic) {
      line += `<details class="exact"><summary>精确值</summary><code>${escapeHtml(p.exact)}</code></details>`;
    } else if (p.exact && p.exact !== p.value) {
      line += `<div class="exact">精确形式：${escapeHtml(p.exact)}</div>`;
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

async function renderResult(res) {
  lastResult = res;
  lastView = "result";
  document.querySelectorAll("#noteChips .chip.on").forEach(c => c.classList.remove("on"));
  if (!res.ok) {
    resultCard.innerHTML = `<div class="error">⚠️ ${escapeHtml(res.error)}</div>`;
    revealResult();
    return;
  }
  let html = "";
  if (res.type === "matrix") {
    html += "<h3>结果</h3>" + renderMatrix(res.data);
  } else if (res.type === "scalar") {
    html += "<h3>结果</h3><div class='scalar'>" + escapeHtml(fmtCell(res.value)) + "</div>";
  } else if (res.type === "lu") {
    html += "<h3>LU 分解 &nbsp; P·A = L·U</h3>";
    html += "<div class='lu-row'>" +
      "<div><h4>P（置换）</h4>" + renderMatrix(res.P) + "</div>" +
      "<div><h4>L（单位下三角）</h4>" + renderMatrix(res.L) + "</div>" +
      "<div><h4>U（上三角）</h4>" + renderMatrix(res.U) + "</div></div>";
  } else if (res.type === "solve") {
    const badge = { unique: "唯一解", none: "无解", infinite: "无穷多解" }[res.status];
    html += `<h3>求解结果：<span class="badge">${badge}</span></h3>`;
    if (res.status !== "none" && res.particular) {
      html += "<h4>特解 x*</h4>" + renderMatrix(res.particular);
    }
    if (res.null_basis && res.null_basis.length) {
      html += `<h4>零空间基（自由变量：${res.free_vars.map(i => "x" + (i + 1)).join(", ")}）</h4>`;
      html += res.null_basis.map(v => renderMatrix(v)).join(" ");
    }
  } else if (res.type === "inverse_status") {
    html += `<div class="error">不存在：${escapeHtml(res.note)}</div>`;
  } else if (res.type === "eigen") {
    html += await renderEigen(res);
  }
  if (res.steps && res.steps.length) {
    let steps = "<h4>计算步骤</h4><ol class='steps'>";
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
  resultCard.innerHTML = html || "<div class='muted-line'>计算完成，无额外输出。</div>";
  revealResult();
}

// --- 请求：两条入口共用，保证结果一致 ---------------------------------------

async function request(payload) {
  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  resultCard.innerHTML = "<div class='muted-line'>计算中…</div>";
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
        `<div class="error">⚠️ 计算超时（>${REQUEST_TIMEOUT_MS / 1000}s），请减小矩阵规模或关闭「显示步骤」。</div>`;
    } else {
      resultCard.innerHTML = `<div class="error">⚠️ 请求失败：${escapeHtml(e)}</div>`;
    }
    return null;
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) inFlight = null;
  }
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
  const res = await request(payload);
  if (res) await renderResult(res);
}

/** 表达式路径：同一个 request，只是换了载荷。 */
async function runExpr() {
  const text = exprIn.value.trim();
  if (!text) { exprIn.focus(); return; }
  const res = await request({
    expr: text,
    matrices: matrixData(),
    showSteps: showSteps.checked,
  });
  if (res) await renderResult(res);
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
  setMsg("设置已保存", "good");
});
el("importImage").addEventListener("click", importFromImage);
el("imageInput").addEventListener("change", onImageChosen);
if (showDecimals) {
  showDecimals.addEventListener("change", () => {
    renderPreview();
    // 右侧正显示讲义时不要把它覆盖掉
    if (lastView === "result" && lastResult) renderResult(lastResult);
  });
}

DEFAULT_NAMES.forEach(n => { state.lib[n] = newMatrix(3, 3); });
state.editing = "A";
refreshAll();

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
    if (btn) btn.textContent = t === "dark" ? "浅色" : "深色";  // 按钮显示「点了会切到」的模式
  }
  function toggle() {
    const next = current() === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (_) { /* 存不了就只本次生效 */ }
  }

  apply(current());
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

// ---------------------------------------------------------------------------
// AI Help：深浅切换旁的「AI Help」按钮，用 GLM-4-Flash（免费）直连解答线代问题。
// 纯静态页无后端：浏览器直接 fetch open.bigmodel.cn（已验证 CORS 允许任意来源），
// Key 只存本机 localStorage，不经过任何中转。问题限制 ≤300 字。
// ---------------------------------------------------------------------------
(function initAiHelp() {
  const KEY_STORE = "la-glm-key";
  const ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const MODEL = "glm-4-flash";
  const MAX = 300;

  const modal = el("aiHelpModal");
  const openBtn = el("aiHelpBtn");
  const closeBtn = el("aiHelpClose");
  const keyBox = el("aiHelpKeyBox");
  const askBox = el("aiHelpAskBox");
  const keyIn = el("aiHelpKeyIn");
  const saveKeyBtn = el("aiHelpSaveKey");
  const keyMsg = el("aiHelpKeyMsg");
  const qEl = el("aiHelpQ");
  const countEl = el("aiHelpCount");
  const sendBtn = el("aiHelpSend");
  const changeKeyBtn = el("aiHelpChangeKey");
  const answerEl = el("aiHelpAnswer");
  const statusEl = el("aiHelpStatus");

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (_) { return ""; }
  }
  function setKey(k) {
    try { localStorage.setItem(KEY_STORE, k || ""); } catch (_) { /* 隐私模式：忽略 */ }
  }

  function showKeyView(msg) {
    keyBox.hidden = false;
    askBox.hidden = true;
    if (msg) keyMsg.textContent = msg;
    keyIn.value = "";
    setTimeout(() => keyIn.focus(), 30);
  }
  function showAskView() {
    keyBox.hidden = true;
    askBox.hidden = false;
    answerEl.textContent = "";
    statusEl.textContent = "";
    updateCount();
    setTimeout(() => qEl.focus(), 30);
  }

  function open() {
    if (getKey()) showAskView(); else showKeyView("");
    modal.hidden = false;
  }
  function close() { modal.hidden = true; }

  function updateCount() {
    const n = qEl.value.length;
    countEl.textContent = n + " / " + MAX;
    sendBtn.disabled = !getKey() || n === 0 || n > MAX;
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) close(); });

  changeKeyBtn.addEventListener("click", () => {
    setKey("");
    showKeyView("已清除本机 Key，请重新填入。");
  });

  saveKeyBtn.addEventListener("click", () => {
    const k = keyIn.value.trim();
    if (!k) { keyMsg.textContent = "请先粘贴 Key。"; return; }
    setKey(k);
    showAskView();
  });

  qEl.addEventListener("input", updateCount);

  sendBtn.addEventListener("click", async () => {
    const q = qEl.value.trim();
    const key = getKey();
    if (!q || !key) return;
    sendBtn.disabled = true;
    answerEl.textContent = "";
    statusEl.textContent = "AI 正在思考…";
    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + key,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content:
              "你是 LA Helper 的线代学习小助手，面向高中生和大学生。用简洁、准确、循序渐进的中文回答线代问题，" +
              "尽量给出关键步骤与直觉，必要时用 LaTeX 风格公式（行内 $...$，独立公式 $$...$$）。" +
              "除非用户要求更详细，否则回答控制在 300 字以内。" },
            { role: "user", content: q },
          ],
          temperature: 0.3,
          max_tokens: 600,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data && data.error && data.error.message;
        if (resp.status === 401) {
          setKey("");
          showKeyView("Key 无效或已过期（" + (msg || "401") + "），请重新填入。");
          return;
        }
        if (resp.status === 429) {
          statusEl.textContent = "免费额度被限流了（429），稍等几秒再试一次。";
          return;
        }
        statusEl.textContent = "出错了：" + (msg || ("HTTP " + resp.status));
        return;
      }
      const ans = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      statusEl.textContent = "";
      answerEl.textContent = ans || "（模型没有返回内容）";
    } catch (err) {
      statusEl.textContent = "网络错误：" + err.message + "（需能访问 open.bigmodel.cn）";
    } finally {
      sendBtn.disabled = false;
      updateCount();
    }
  });

  updateCount();
})();

// ---------------------------------------------------------------------------
// 线代难点小讲义：点左侧的一篇，右侧结果区显示讲解。
// 内容放在这里（会打包进静态预览版）；样式见 index.html 的 .notes-body / .note-*。
// blocks 里每一项：字符串 = 段落；{h} 小标题；{ul} 项目符号；{formula} 公式块；
// {tip} 提示块。内容是自己写的静态文案，直接当 HTML 用（所以 < 写成 &lt;）。
// ---------------------------------------------------------------------------
const NOTES = [
  {
    id: "cofactor",
    title: "代数余子式到底在干什么",
    tag: "行列式",
    lead: "一句话：把 n 阶行列式「拆」成 n 个 (n−1) 阶行列式的带符号和；还不够小就接着拆，直到只剩 1 阶。",
    blocks: [
      { h: "先记住展开公式" },
      { formula: "det(A) = Σⱼ (−1)^(i+j) · a(i,j) · M(i,j)　（i 是任选的一行）" },
      "读法：<b>固定某一行 i</b>，把这行的每个元素 a(i,j) 乘上它对应的余子式 M(i,j)，再乘符号 (−1)^(i+j)，最后全部加起来。",
      { h: "三个容易混的概念" },
      { ul: [
        "<b>余子式 M(i,j)</b>：把第 i 行和第 j 列<b>整条划掉</b>（划一个十字），剩下的小矩阵，取它的行列式。",
        "<b>代数余子式</b>：就是 (−1)^(i+j) · M(i,j)，比余子式多一个符号。",
        "<b>符号只看位置</b>：只看 (i,j)，和你划掉的那个数本身是正是负完全无关。",
      ] },
      { h: "符号怎么快速记" },
      "从左上角 (1,1) 开始是 +，然后像棋盘一样交错：+ − + / − + − / + − +。等价说法：i+j 是偶数取 +，是奇数取 −。",
      { h: "为什么可以「任选一行」" },
      "因为行列式对自己的每一行都是<b>线性</b>的（把某一行拆成两项之和，行列式就等于两个行列式之和），而且<b>交换两行会变号</b>。把第 i 行拆成 n 个「只有第 j 个位置非零」的行，剩下的那个行列式正好就是 M(i,j)，换行带来的符号正好是 (−1)^(i+j)。所以沿任何一行、任何一列展开，结果都一样 —— 挑最好算的那条就行。",
      { h: "最容易卡的 4 个点" },
      { ul: [
        "忘了要<b>递归</b>：展开出来的每一项还是一个低一阶的行列式，得接着展开，不是一步出结果。",
        "划错范围：是「第 i 行<b>和</b>第 j 列」都划掉（十字），不是只划一个。",
        "把 M(i,j)（余子式）和「代数余子式」当成一回事（差一个 (−1)^(i+j)）。",
        "符号看错：只看位置，不看数字的正负。",
      ] },
      { h: "手算技巧" },
      "<b>永远挑 0 最多的那一行或那一列展开</b>：0 乘任何余子式都是 0，那一项可以直接跳过，能省掉一大半工作。",
      { tip: "在本页试一下：操作选「行列式 det(A)」，把旁边的「det 算法」切成「代数余子式展开」。每一步都会跟着一张<strong>这一步的余子式</strong>，对着上面的公式慢慢走一遍就通了。" },
    ],
  },
  {
    id: "row-reduction",
    title: "为什么行列式能用行变换来算",
    tag: "行列式",
    lead: "因为行列式对三种初等行变换的反应非常规则；把它化成三角阵，答案就是对角线相乘。",
    blocks: [
      { h: "三种行变换对 det 的影响" },
      { ul: [
        "交换两行 → 行列式<b>变号</b>",
        "某一行乘以常数 k → 行列式<b>也乘 k</b>",
        "某一行加上另一行的倍数 → 行列式<b>不变</b>",
      ] },
      { h: "化到三角阵就结束了" },
      "上三角（或下三角）矩阵的行列式 = 对角线元素相乘。因为按第一行（或第一列）展开时只有一项非零，一路递归下去就只剩主对角线。",
      { formula: "det(A) = (−1)^s · ∏ᵢ u(i,i)　（s = 交换行的次数）" },
      { h: "和 LU 分解的关系" },
      "消元得到的 U 就是上三角，L 是单位下三角（对角线全是 1，所以 det(L) = 1），P 记录了换行。由 PA = LU 得 det(P)·det(A) = det(L)·det(U)，而 det(P) = (−1)^s，于是 det(A) = (−1)^s · ∏u(i,i)。本页的「行变换法」走的就是这条路线。",
      { h: "为什么大矩阵必须用行变换" },
      "代数余子式展开要算 n! 项（3 阶 6 项、6 阶 720 项、10 阶 360 多万项）；行变换只需要大约 n³ 次运算。所以：<b>小矩阵用代数余子式理解原理，大矩阵用行变换去算</b>。两种算法的结果必然相同。",
      { tip: "在本页试一下：同一个矩阵先选「行变换法」算一次，再切「代数余子式展开」算一次。数值必然一样，但步骤风格完全不同。" },
    ],
  },
  {
    id: "matmul",
    title: "矩阵乘法为什么这么怪",
    tag: "矩阵运算",
    lead: "「行乘列再相加」不是随便定的，它对应的含义是：先做一个变换，再做另一个变换。",
    blocks: [
      { h: "两种等价的读法" },
      { ul: [
        "<b>行 × 列</b>：(A·B)(i,j) = A 的第 i 行与 B 的第 j 列做点积。",
        "<b>列的线性组合</b>：A·B 的第 j 列 = A 乘以 B 的第 j 列 —— B 的每一列在告诉你「把 A 的各列怎么混起来」。",
      ] },
      { h: "所以 AB 一般不等于 BA" },
      "矩阵代表变换。A·B 的意思是<b>先做 B、再做 A</b>；顺序一换结果就不同（先旋转再拉伸 ≠ 先拉伸再旋转）。",
      { h: "维度规则" },
      "只有 (m×k)·(k×n) 才合法：中间那个 k 必须对上，结果维度是 m×n。",
      { tip: "在本页试一下：A、B 都填好，操作选「矩阵乘法 A×B」算一次；再交换成 B×A 算一次，对比结果。" },
    ],
  },
  {
    id: "singular",
    title: "det = 0 为什么就没有逆",
    tag: "可逆性",
    lead: "因为行列式是「体积缩放因子」。为 0 意味着空间被压扁了，压扁之后信息丢了，回不去。",
    blocks: [
      { h: "几何图像" },
      "2×2 矩阵把单位正方形变成一个平行四边形，|det| 就是它的面积（3×3 对应体积）。det = 0 → 面积/体积变成 0 → 平面被压成一条线甚至一个点：降维了。此时两个不同的输入可能被映射到同一个输出，这个映射就没办法反推。",
      { h: "四句话说的是一件事" },
      { ul: [
        "A 不可逆",
        "det(A) = 0",
        "A 的行（或列）线性相关",
        "rank(A) &lt; n（存在非零的零空间向量）",
      ] },
      "这四个说法互相等价，看到其中一个就能推出另外三个。",
      { tip: "在本页试一下：填一个两行成比例的矩阵（比如第 2 行 = 2 × 第 1 行），先求逆看提示，再算它的行列式和秩。" },
    ],
  },
  {
    id: "rank",
    title: "秩到底在说什么",
    tag: "秩",
    lead: "秩 = 这个矩阵里「真正独立的信息」有几条。",
    blocks: [
      { h: "三个等价的说法" },
      { ul: [
        "线性无关的行的最大个数（也等于线性无关列的最大个数）",
        "化成 REF 之后<b>主元的个数</b>",
        "它把空间映射到的「像空间」的维数 —— 输出被压到了几维",
      ] },
      { h: "秩不足意味着什么" },
      "秩 &lt; n 说明有冗余的行（能被别人线性组合出来）。于是 A·x = 0 有非零解（零空间里的向量就是被压成 0 的那些方向），而 A·x = b 可能无解、也可能有无穷多解。",
      { tip: "在本页试一下：操作选「秩 rank(A)」和「REF 行阶梯形」各算一次 —— 数一数 REF 里的主元个数，一定等于 rank。" },
    ],
  },
  {
    id: "eigen",
    title: "特征值 / 特征向量的几何意义",
    tag: "特征值",
    lead: "Av = λv 的意思是：向量 v 在这个变换下<b>方向不变</b>，只是被拉长或压短了 λ 倍。",
    blocks: [
      { h: "为什么重要" },
      "一般向量被矩阵一乘，方向和长度都会变；特征向量是「例外」的那些方向 —— 它们揭示了变换最本质的行为：沿这些方向只是缩放。",
      { h: "特征值告诉你什么" },
      { ul: [
        "λ = 0：这个方向被压成 0 → 矩阵一定不可逆、det = 0。",
        "λ 是复数：这个方向其实被<b>旋转</b>了（比如旋转 90° 的矩阵没有实特征向量）。",
        "<b>代数重数</b>：特征多项式里这个根的次数；<b>几何重数</b>：对应的线性无关特征向量的个数。",
      ] },
      { h: "为什么有些矩阵不能对角化" },
      "当某个特征值的几何重数 &lt; 代数重数时，特征向量不够多、凑不齐一组基，就没法对角化（本页的结果里会直接标出「不可对角化」）。",
      { tip: "在本页试一下：用 [[0,-1],[1,0]] 算特征值 —— 你会看到 λ = i / −i，这就是「纯旋转」；再拿 [[2,0],[0,2]] 对比。" },
    ],
  },
];

function renderNoteChips() {
  const box = el("noteChips");
  if (!box) return;
  box.innerHTML = "";
  for (const n of NOTES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip note-chip";
    chip.dataset.note = n.id;
    chip.textContent = n.title;
    chip.title = n.lead;
    chip.addEventListener("click", () => renderNote(n.id));
    box.appendChild(chip);
  }
}

function noteBlocksHtml(blocks) {
  let html = "";
  for (const b of blocks) {
    if (typeof b === "string") html += "<p>" + b + "</p>";
    else if (b.h) html += "<h4>" + b.h + "</h4>";
    else if (b.ul) {
      html += "<ul>" + b.ul.map((x) => "<li>" + x + "</li>").join("") + "</ul>";
    } else if (b.formula) {
      html += "<div class='note-formula'>" + b.formula + "</div>";
    } else if (b.tip) {
      html += "<div class='note-tip'>" + b.tip + "</div>";
    }
  }
  return html;
}

/** 在右侧结果区显示一篇讲义（再点「计算」就切回结果）。 */
function renderNote(id) {
  const n = NOTES.find((x) => x.id === id);
  if (!n) return;
  for (const c of document.querySelectorAll("#noteChips .chip")) {
    c.classList.toggle("on", c.dataset.note === id);
  }
  resultCard.innerHTML =
    "<h3>" + n.title + " <span class='badge'>" + n.tag + "</span></h3>" +
    "<p class='note-lead'>" + n.lead + "</p>" +
    "<div class='notes-body'>" + noteBlocksHtml(n.blocks) + "</div>";
  lastView = "note";
  revealResult();
}

renderNoteChips();

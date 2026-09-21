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
    if (lastResult) renderResult(lastResult);
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

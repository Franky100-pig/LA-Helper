"use strict";

const OPS_NEED_B = new Set(["multiply", "add", "sub", "solve", "scalar"]);
const MIN_DIM = 1;
const MAX_DIM = 16;
const REQUEST_TIMEOUT_MS = 30000;

const opSelect = document.getElementById("op");
const showSteps = document.getElementById("showSteps");
const showDecimals = document.getElementById("showDecimals");
const panelB = document.getElementById("panelB");
const resultEl = document.getElementById("result");
const resultCard = resultEl.querySelector(".result-card");

let inFlight = null;
let lastResult = null;

function clampDim(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return MIN_DIM;
  return Math.min(MAX_DIM, Math.max(MIN_DIM, n));
}

function gridId(prefix) { return prefix === "A" ? "gridA" : "gridB"; }
function rowsId(prefix) { return prefix === "A" ? "rowsA" : "rowsB"; }
function colsId(prefix) { return prefix === "A" ? "colsA" : "colsB"; }

function buildGrid(prefix) {
  // Clamp once, then write the clamped value back: the number inputs and the
  // grid must never disagree (otherwise readMatrix silently pads with zeros).
  const rowsInput = document.getElementById(rowsId(prefix));
  const colsInput = document.getElementById(colsId(prefix));
  const rows = clampDim(rowsInput.value);
  const cols = clampDim(colsInput.value);
  rowsInput.value = rows;
  colsInput.value = cols;

  const grid = document.getElementById(gridId(prefix));
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${cols}, 64px)`;
  grid.dataset.rows = rows;
  grid.dataset.cols = cols;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "cell";
      inp.dataset.r = r;
      inp.dataset.c = c;
      inp.addEventListener("keydown", cellKeyNav);
      grid.appendChild(inp);
    }
  }
}

function cellKeyNav(e) {
  const el = e.target;
  const r = parseInt(el.dataset.r, 10);
  const c = parseInt(el.dataset.c, 10);
  const grid = el.parentElement;
  const cols = parseInt(grid.dataset.cols, 10);
  const rows = parseInt(grid.dataset.rows, 10);
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

function readMatrix(prefix) {
  // Read what is actually on screen, not what the number inputs claim.
  const grid = document.getElementById(gridId(prefix));
  const rows = parseInt(grid.dataset.rows, 10);
  const cols = parseInt(grid.dataset.cols, 10);
  const data = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const el = grid.querySelector(`input[data-r="${r}"][data-c="${c}"]`);
      const v = el && el.value.trim() !== "" ? el.value.trim() : "0";
      row.push(v);
    }
    data.push(row);
  }
  return data;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// --- display formatting -----------------------------------------------------

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

function renderMatrix(mat) {
  let body = "";
  for (const row of mat) {
    body += "<tr>" + row.map(v => `<td>${escapeHtml(fmtCell(v))}</td>`).join("") + "</tr>";
  }
  return `<div class="matrix-box"><span class="bracket">[</span><table class="mat">${body}</table><span class="bracket">]</span></div>`;
}

function renderEigen(res) {
  let html = "<h3>特征值 / 特征向量</h3>";
  res.pairs.forEach(p => {
    const lam = escapeHtml(fmtCell(p.value));
    html += `<div class="eig"><div>λ = <b>${lam}</b>`;
    html += ` （代数重数 ${p.multiplicity}`;
    if (p.geometric !== undefined && p.geometric < p.multiplicity) {
      html += `，几何重数 ${p.geometric} → <span class="warn">不可对角化</span>`;
    }
    html += "）</div>";
    if (p.approx && p.exact && p.exact !== p.value) {
      html += `<details class="exact"><summary>精确值</summary><code>${escapeHtml(p.exact)}</code></details>`;
    }
    html += p.vectors.map(v => renderMatrix(v)).join(" ");
    html += "</div>";
  });
  return html;
}

function renderResult(res) {
  lastResult = res;
  if (!res.ok) {
    resultCard.innerHTML = `<div class="error">⚠️ ${escapeHtml(res.error)}</div>`;
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
    html += renderEigen(res);
  }
  if (res.steps && res.steps.length) {
    html += "<h4>计算步骤</h4><ol class='steps'>" +
      res.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("") + "</ol>";
  }
  resultCard.innerHTML = html || "<div class='muted-line'>计算完成，无额外输出。</div>";
}

// --- request ----------------------------------------------------------------

async function compute() {
  const op = opSelect.value;
  const payload = { op, A: readMatrix("A"), showSteps: showSteps.checked };
  if (OPS_NEED_B.has(op)) payload.B = readMatrix("B");

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
    renderResult(res);
  } catch (e) {
    if (e.name === "AbortError") {
      resultCard.innerHTML =
        `<div class="error">⚠️ 计算超时（>${REQUEST_TIMEOUT_MS / 1000}s），请减小矩阵规模或关闭「显示步骤」。</div>`;
    } else {
      resultCard.innerHTML = `<div class="error">⚠️ 请求失败：${escapeHtml(e)}</div>`;
    }
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) inFlight = null;
  }
}

function refreshB() {
  panelB.style.display = OPS_NEED_B.has(opSelect.value) ? "" : "none";
}

opSelect.addEventListener("change", refreshB);
document.getElementById("compute").addEventListener("click", compute);
if (showDecimals) {
  showDecimals.addEventListener("change", () => {
    if (lastResult) renderResult(lastResult);
  });
}
["A", "B"].forEach(p => {
  ["rows", "cols"].forEach(d => {
    document.getElementById(d + p).addEventListener("change", () => buildGrid(p));
  });
});

buildGrid("A");
buildGrid("B");
refreshB();

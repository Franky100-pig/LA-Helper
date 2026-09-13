"use strict";

const OPS_NEED_B = new Set(["multiply", "add", "sub", "solve"]);

const opSelect = document.getElementById("op");
const showSteps = document.getElementById("showSteps");
const panelB = document.getElementById("panelB");
const resultEl = document.getElementById("result");
const resultCard = resultEl.querySelector(".result-card");

function buildGrid(gridId, rowsId, colsId) {
  const rows = Math.min(16, Math.max(1, parseInt(document.getElementById(rowsId).value, 10) || 1));
  const cols = Math.min(16, Math.max(1, parseInt(document.getElementById(colsId).value, 10) || 1));
  const grid = document.getElementById(gridId);
  grid.innerHTML = "";
  grid.style.gridTemplateColumns = `repeat(${cols}, 64px)`;
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
  const cols = parseInt(grid.style.gridTemplateColumns.match(/repeat\((\d+)/)?.[1] || 1, 10);
  const rows = grid.querySelectorAll("input").length / cols;
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
  const grid = document.getElementById(prefix === "A" ? "gridA" : "gridB");
  const rows = parseInt(document.getElementById(prefix === "A" ? "rowsA" : "rowsB").value, 10);
  const cols = parseInt(document.getElementById(prefix === "A" ? "colsA" : "colsB").value, 10);
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
  return String(s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function renderMatrix(mat) {
  let body = "";
  for (const row of mat) {
    body += "<tr>" + row.map(v => `<td>${escapeHtml(v)}</td>`).join("") + "</tr>";
  }
  return `<div class="matrix-box"><span class="bracket">[</span><table class="mat">${body}</table><span class="bracket">]</span></div>`;
}

function renderResult(res) {
  if (!res.ok) {
    resultCard.innerHTML = `<div class="error">⚠️ ${escapeHtml(res.error)}</div>`;
    return;
  }
  let html = "";
  if (res.type === "matrix") {
    html += "<h3>结果</h3>" + renderMatrix(res.data);
  } else if (res.type === "scalar") {
    html += "<h3>结果</h3><div class='scalar'>" + escapeHtml(res.value) + "</div>";
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
    html += "<h3>特征值 / 特征向量</h3>";
    res.pairs.forEach(p => {
      html += `<div class="eig"><div>λ = <b>${escapeHtml(p.value)}</b> （代数重数 ${p.multiplicity}）</div>`;
      html += p.vectors.map(v => renderMatrix(v)).join(" ");
      html += "</div>";
    });
  }
  if (res.steps && res.steps.length) {
    html += "<h4>计算步骤</h4><ol class='steps'>" +
      res.steps.map(s => `<li>${escapeHtml(s)}</li>`).join("") + "</ol>";
  }
  resultCard.innerHTML = html || "<div class='muted-line'>计算完成，无额外输出。</div>";
}

async function compute() {
  const op = opSelect.value;
  const payload = { op, A: readMatrix("A"), showSteps: showSteps.checked };
  if (OPS_NEED_B.has(op)) payload.B = readMatrix("B");
  resultCard.innerHTML = "<div class='muted-line'>计算中…</div>";
  try {
    const resp = await fetch("/api/compute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const res = await resp.json();
    renderResult(res);
  } catch (e) {
    resultCard.innerHTML = `<div class="error">⚠️ 请求失败：${escapeHtml(e)}</div>`;
  }
}

function rebuild(prefix) {
  if (prefix === "A") buildGrid("gridA", "rowsA", "colsA");
  else buildGrid("gridB", "rowsB", "colsB");
}

function refreshB() {
  panelB.style.display = OPS_NEED_B.has(opSelect.value) ? "" : "none";
}

opSelect.addEventListener("change", refreshB);
document.getElementById("compute").addEventListener("click", compute);
["rowsA", "colsA"].forEach(id =>
  document.getElementById(id).addEventListener("change", () => rebuild("A")));
["rowsB", "colsB"].forEach(id =>
  document.getElementById(id).addEventListener("change", () => rebuild("B")));

rebuild("A");
rebuild("B");
refreshB();

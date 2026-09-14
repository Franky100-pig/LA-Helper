"""Build a self-contained static preview of LA Helper.

The real engine (core/*.py, SymPy) is bundled and executed in the browser via
Pyodide, so the deployed static page behaves identically to the local server.

Run:  python tools/build_preview.py
Out:  ../la-preview/  (index.html, app.js, la-bridge.js, core_bundle.js)
"""
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT.parent / "la-preview"
PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/"


def bundle_core():
    """Collect core modules with relative imports rewritten to flat ones."""
    files = {}
    for p in sorted((ROOT / "core").glob("*.py")):
        if p.name == "__init__.py":
            continue
        src = p.read_text(encoding="utf-8")
        src = re.sub(r"^from \.(\w+) import", r"from \1 import", src, flags=re.M)
        src = re.sub(r"^from \. import", "import", src, flags=re.M)
        files[p.name] = src
    return files


def build_index(html):
    html = html.replace(
        '<button id="compute">计算</button>',
        '<button id="compute" disabled>计算</button>',
    )
    html = html.replace(
        "<script src=\"app.js\"></script>",
        '<p id="engineStatus" class="hint">正在加载计算引擎（首次约需十几秒，之后秒回）…</p>\n'
        '<script src="core_bundle.js"></script>\n'
        f'<script src="{PYODIDE_URL}pyodide.js"></script>\n'
        '<script src="la-bridge.js"></script>\n'
        '<script src="app.js"></script>',
    )
    return html


def build_app_js(js):
    # 1. engine-not-ready guard at the top of compute()
    js = js.replace(
        "async function compute() {",
        "async function compute() {\n"
        "  if (!window.LA || !window.LA.ready) {\n"
        "    resultCard.innerHTML = \"<div class='muted-line'>计算引擎加载中，请稍候…</div>\";\n"
        "    return;\n"
        "  }",
        1,
    )
    # 2. replace the HTTP fetch with the in-browser engine call
    js = re.sub(
        r"const resp = await fetch\(\"/api/compute\", \{.*?\}\);\s*"
        r"const res = await resp\.json\(\);",
        "const res = await window.LA.compute(payload);",
        js,
        count=1,
        flags=re.S,
    )
    return js


BRIDGE = """\
"use strict";
// Boots CPython + SymPy (Pyodide/WASM) and exposes window.LA.compute().
window.LA = { ready: false, error: null, compute: null };

function laPayload(payload) {
  const py = (v) => JSON.stringify(v);
  const op = py(payload.op);
  const A = py(payload.A);
  const B = payload.B === undefined ? "None" : py(payload.B);
  const ss = payload.showSteps ? "True" : "False";
  return `_la_compute(${op}, ${A}, ${B}, ${ss})`;
}

(async function boot() {
  const status = document.getElementById("engineStatus");
  const btn = document.getElementById("compute");
  try {
    const pyodide = await loadPyodide({ indexURL: "__PYODIDE_URL__" });
    await pyodide.loadPackage("sympy");
    const FS = pyodide.FS;
    try { FS.mkdir("/la"); } catch (e) { /* exists */ }
    for (const [name, src] of Object.entries(window.LA_CORE_FILES)) {
      FS.writeFile("/la/" + name, src);
    }
    pyodide.runPython(
      'import sys, json\\n' +
      'if "/la" not in sys.path:\\n' +
      '    sys.path.insert(0, "/la")\\n' +
      'import engine\\n' +
      'def _la_compute(op, A, B, show_steps):\\n' +
      '    return json.dumps(engine.compute(op, A, B, show_steps), ensure_ascii=False)\\n'
    );
    window.LA.compute = (payload) =>
      JSON.parse(pyodide.runPython(laPayload(payload)));
    window.LA.ready = true;
    if (status) status.textContent = "计算引擎已就绪 · 本地 Python/SymPy（WebAssembly）";
    if (btn) btn.disabled = false;
  } catch (err) {
    window.LA.error = String(err);
    if (status) status.textContent = "引擎加载失败：" + err;
  }
})();
""".replace("__PYODIDE_URL__", PYODIDE_URL)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    core = bundle_core()
    (OUT / "core_bundle.js").write_text(
        "window.LA_CORE_FILES = " + json.dumps(core, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    web = ROOT / "web"
    (OUT / "index.html").write_text(
        build_index((web / "index.html").read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    (OUT / "app.js").write_text(
        build_app_js((web / "app.js").read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    (OUT / "la-bridge.js").write_text(BRIDGE, encoding="utf-8")
    print("built ->", OUT)
    print("core modules:", ", ".join(core))


if __name__ == "__main__":
    main()

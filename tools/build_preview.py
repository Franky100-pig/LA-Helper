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
    """Collect core modules with relative imports rewritten to flat ones.

    The rewrite is indentation-aware: a relative import inside a function body
    (e.g. engine.dispatch's lazy `from . import expr`) must be flattened too,
    otherwise the bundled module raises ImportError in the browser.
    """
    files = {}
    for p in sorted((ROOT / "core").glob("*.py")):
        if p.name == "__init__.py":
            continue
        src = p.read_text(encoding="utf-8")
        # `from .mod import x` -> `from mod import x`, keeping any indent.
        src = re.sub(r"^(\s*)from \.(\w+) import", r"\1from \2 import", src,
                     flags=re.M)
        # `from . import mod` -> `import mod`, keeping any indent.
        src = re.sub(r"^(\s*)from \. import", r"\1import", src, flags=re.M)
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
    # 1. engine-not-ready guard. Both entry points (the operation dropdown and
    #    the expression box) funnel through request(), so one guard covers both.
    js = js.replace(
        "async function request(payload) {",
        "async function request(payload) {\n"
        "  if (!window.LA || !window.LA.ready) {\n"
        "    resultCard.innerHTML = \"<div class='muted-line'>计算引擎加载中，请稍候…</div>\";\n"
        "    return undefined;\n"
        "  }",
        1,
    )
    # 2. replace the HTTP fetch with the in-browser engine call. Same request
    #    envelope, so op-requests and expr-requests both work unchanged.
    js = re.sub(
        r"const resp = await fetch\(\"/api/compute\", \{.*?\}\);\s*"
        r"const res = await resp\.json\(\);",
        "const res = await window.LA.dispatch(payload);",
        js,
        count=1,
        flags=re.S,
    )
    return js


BRIDGE = """\
"use strict";
// Boots CPython + SymPy (Pyodide/WASM) and exposes window.LA.dispatch().
window.LA = { ready: false, error: null, dispatch: null };

// The whole request envelope (op *or* expr) crosses into Python as JSON, so the
// browser runs exactly the same dispatch() the local server runs.
function laDispatch(req) {
  return `_la_dispatch(${JSON.stringify(JSON.stringify(req))})`;
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
      'def _la_dispatch(req_json):\\n' +
      '    return json.dumps(engine.dispatch(json.loads(req_json)), ensure_ascii=False)\\n'
    );
    window.LA.dispatch = (req) => JSON.parse(pyodide.runPython(laDispatch(req)));
    window.LA.pyodide = pyodide;
    window.LA.ready = true;
    // 图片导入：浏览器把 Gemini 返回的原始文本交给共享 Python 解析器
    // （与桌面端 core.photo.parse_matrix_response 同一份实现，保证两端一致）。
    window.LA.parsePhoto = (rawText) => {
      if (!rawText || !String(rawText).trim()) {
        return { ok: false, error: "模型返回为空。", raw: String(rawText || "") };
      }
      const pyLines = [
        "import json",
        "import photo",
        "try:",
        "    _m = photo.parse_matrix_response(" + JSON.stringify(JSON.stringify(rawText)) + ")",
        '    _out = {"ok": True, "matrix": _m}',
        "except photo.PhotoError as _e:",
        '    _out = {"ok": False, "error": str(_e), "raw": _e.raw}',
        "_photo_result = json.dumps(_out, ensure_ascii=False)",
      ];
      const py = pyLines.join("\\n");
      return JSON.parse(pyodide.runPython(py));
    };
    // 提示词也单一来源：网页端不再自带一份，直接向 Python 要，避免两端措辞漂移。
    window.LA.photoPrompt = () => pyodide.runPython("import photo; photo.build_prompt()");
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

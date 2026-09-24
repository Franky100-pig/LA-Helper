"""Build a self-contained static preview of LA Helper.

The real engine (core/*.py, SymPy) is bundled and executed in the browser via
Pyodide, so the deployed static page behaves identically to the local server.

Run:  python tools/build_preview.py
Out:  ../la-preview/  (index.html, app.js, la-bridge.js, core_bundle.js)
"""
import json
import os
import pathlib
import re
import hashlib

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
# Default: a sibling dir so local previews never touch the repo. CI overrides
# this to build inside the repo (e.g. `public/`) so the Pages artifact can pick
# it up.
OUT_DEFAULT = ROOT.parent / "la-preview"
OUT = pathlib.Path(os.environ.get("LA_PREVIEW_OUT", OUT_DEFAULT))
PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/"


def _content_version(web_app_js, core, ai_help_js="", i18n_js="", notes_js=""):
    """Short hash of the bundled JS so the cache-bust query changes whenever the
    shipped code changes (a git hash would lag one commit behind the build).

    i18n.js / notes.js must be part of the hash: they carry every user-facing
    string, so a wording-only change has to bust the cache too.
    """
    blob = (json.dumps(core, ensure_ascii=False) + BRIDGE + web_app_js
            + ai_help_js + i18n_js + notes_js)
    return hashlib.sha1(blob.encode("utf-8")).hexdigest()[:8]


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


def build_index(html, ver=""):
    # 引擎就绪前禁用「计算」按钮。用正则匹配属性，避免文案进了 i18n 之后
    # 这里的字符串替换悄悄失效（按钮现在是 data-i18n 的）。
    html = re.sub(
        r'<button id="compute"([^>]*)>',
        r'<button id="compute"\1 disabled>',
        html,
        count=1,
    )
    # 给本地脚本加 ?v=... 版本号，强制浏览器在重新部署后拉取最新 JS，
    # 避免旧 la-bridge.js（带 bug 的桥）被长期缓存导致页面显示 undefined。
    q = f"?v={ver}" if ver else ""
    html = html.replace(
        '<script src="i18n.js"></script>', f'<script src="i18n.js{q}"></script>')
    html = html.replace(
        '<script src="notes.js"></script>', f'<script src="notes.js{q}"></script>')
    html = html.replace(
        "<script src=\"app.js\"></script>",
        '<p id="engineStatus" class="hint" data-i18n="engine.loading">'
        '正在加载计算引擎（首次约需十几秒，之后秒回）…</p>\n'
        f'<script src="core_bundle.js{q}"></script>\n'
        f'<script src="{PYODIDE_URL}pyodide.js"></script>\n'
        f'<script src="la-bridge.js{q}"></script>\n'
        f'<script src="app.js{q}"></script>',
    )
    return html


def build_app_js(js):
    # 1. engine-not-ready guard. Both entry points (the operation dropdown and
    #    the expression box) funnel through request(), so one guard covers both.
    js = js.replace(
        "async function request(payload) {",
        "async function request(payload) {\n"
        "  if (!window.LA || !window.LA.ready) {\n"
        "    resultCard.innerHTML = \"<div class='muted-line'>\" + tr(\"engine.busy\") + \"</div>\";\n"
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
      'import format_math\\n' +
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
        // 结尾必须是表达式（runPython 只返回最后一个表达式的值，赋值会得到 undefined）
        "json.dumps(_out, ensure_ascii=False)",
      ];
      const py = pyLines.join("\\n");
      return JSON.parse(pyodide.runPython(py));
    };
    // 提示词也单一来源：网页端不再自带一份，直接向 Python 要，避免两端措辞漂移。
    window.LA.photoPrompt = () => pyodide.runPython("import photo; photo.build_prompt()");
    // 公式美化也单一来源：网页端把精确值字符串交给 Python 排版（竖式分数 / √ /
    // 小数），与桌面端 core.format_math 同一份实现，保证两端一致。
    window.LA.mathHtml = (s) => {
      // Pyodide runPython 只返回最后一个“表达式”的值（return_mode="last_expr"），
      // 最后一行若是赋值语句会得到 undefined——所以结尾必须是表达式 `_h`。
      const pyLines = [
        "import format_math",
        "try:",
        "    _h = format_math.to_html(" + JSON.stringify(s ?? "") + ")",
        "except Exception as _e:",
        '    _h = format_math._escape(str(_e))',
        "_h",
      ];
      return pyodide.runPython(pyLines.join("\\n"));
    };
    window.LA.stepHtml = (s) => {
      // 同样必须以表达式结尾（runPython 只返回最后一个表达式的值），并兜底异常，
      // 保证任何情况下都返回字符串、绝不返回 undefined。
      const pyLines = [
        "import format_math",
        "try:",
        "    _h = format_math.step_html(" + JSON.stringify(s ?? "") + ")",
        "except Exception as _e:",
        '    _h = format_math._escape(str(_e))',
        "_h",
      ];
      return pyodide.runPython(pyLines.join("\\n"));
    };
    // 状态文案走 i18n（i18n.js 在 <head> 里先于本文件加载）
    if (status) status.textContent = window.LA_I18N.t("engine.ready");
    if (btn) btn.disabled = false;
  } catch (err) {
    window.LA.error = String(err);
    if (status) status.textContent = window.LA_I18N.t("engine.fail") + err;
  }
})();
""".replace("__PYODIDE_URL__", PYODIDE_URL)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    core = bundle_core()
    web = ROOT / "web"
    web_app_js = (web / "app.js").read_text(encoding="utf-8")
    ai_help_js = (web / "ai-help.js").read_text(encoding="utf-8") if (web / "ai-help.js").exists() else ""

    def _read(name):
        f = web / name
        return f.read_text(encoding="utf-8") if f.exists() else ""

    i18n_js = _read("i18n.js")
    notes_js = _read("notes.js")
    ver = _content_version(web_app_js, core, ai_help_js, i18n_js, notes_js)
    (OUT / "core_bundle.js").write_text(
        "window.LA_CORE_FILES = " + json.dumps(core, ensure_ascii=False) + ";\n",
        encoding="utf-8",
    )
    (OUT / "index.html").write_text(
        build_index((web / "index.html").read_text(encoding="utf-8"), ver),
        encoding="utf-8",
    )
    (OUT / "app.js").write_text(
        build_app_js((web / "app.js").read_text(encoding="utf-8")),
        encoding="utf-8",
    )
    (OUT / "la-bridge.js").write_text(BRIDGE, encoding="utf-8")
    # 双语字典与讲义：主页和 AI Help 页都要用，原样复制（版本由 ?v 统一兜住）
    for name, src in (("i18n.js", i18n_js), ("notes.js", notes_js)):
        if src:
            (OUT / name).write_text(src, encoding="utf-8")
    # AI Help 独立页：不依赖 Pyodide 引擎，单独复制；脚本引用同样加 ?v 缓存 bust。
    if (web / "ai-help.html").exists():
        q = f"?v={ver}" if ver else ""
        ah = (web / "ai-help.html").read_text(encoding="utf-8")
        ah = ah.replace('<script src="i18n.js"></script>', f'<script src="i18n.js{q}"></script>')
        ah = ah.replace('<script src="ai-help.js"></script>', f'<script src="ai-help.js{q}"></script>')
        (OUT / "ai-help.html").write_text(ah, encoding="utf-8")
    if (web / "ai-help.js").exists():
        (OUT / "ai-help.js").write_text((web / "ai-help.js").read_text(encoding="utf-8"), encoding="utf-8")
    # 关掉 GitHub Pages 的 Jekyll 处理（否则以下划线开头的文件会被忽略，
    # 且 Jekyll 可能改写内容）。纯静态站不需要它。
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    print("built ->", OUT)
    print("core modules:", ", ".join(core))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""守住「引擎输出不许把中文漏到英文界面」这条底线。

PR #9 加了 tools/check_no_hardcoded_zh.js 管界面外壳；这个管另一半 ——
core/ 里算出来的步骤与报错。两边必须一起看，只查一边等于没查：
界面全是英文、推导全是中文，是最容易被当成「做完了」的状态。

三件事：

1. **core/ 除 i18n.py 外不得有硬编码中文**（注释与 docstring 不算）。
   新的文案一律进字典，否则 bilingual 的承诺会随时间被侵蚀。
2. **字典自身要完整**：每条 key 都得有 zh 和 en，都得非空。
   只写一边是这类改动最常见的半成品 —— 中文照常，英文退回中文。
3. **占位符必须两种语言一致**：把 {name} 这类字段抽出来排序比对。
   漏一个占位符不会报错，只会让 .format 抛异常或悄悄留下花括号，
   而发生的时候是在学生面前。

顺带把「英文输出里不得含中文」也断言一遍（第 4 件事）—— 前三条查的是源码，
这一条查的是实际输出，才知道 tr() 真的接上了。
"""
import ast
import io
import pathlib
import re
import sys
import tokenize

ROOT = pathlib.Path(__file__).resolve().parent.parent
CORE = ROOT / "core"
sys.path.insert(0, str(ROOT))

from core import engine, i18n  # noqa: E402

CJK = re.compile(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]")
PLACEHOLDER = re.compile(r"\{([a-zA-Z_][a-zA-Z0-9_]*)[^}]*\}")

problems = []


def note(where, text):
    problems.append(f"{where}: {text}")


# --- 1. core/ 里不该再有硬编码中文 -----------------------------------------
def strip_comments(src):
    """Blank out trailing comments, keeping every line and column in place.

    Comments are allowed to be Chinese (they explain the maths to the next
    reader); what is banned is Chinese in a string a student can see. Blanking
    via tokenize rather than splitting on "#" keeps a "#" inside a string
    literal from being mistaken for a comment.
    """
    lines = src.split("\n")
    try:
        for tok in tokenize.generate_tokens(io.StringIO(src).readline):
            if tok.type == tokenize.COMMENT:
                ln = tok.start[0]
                tail = len(lines[ln - 1]) - tok.start[1]
                lines[ln - 1] = lines[ln - 1][:tok.start[1]] + " " * tail
    except (tokenize.TokenError, IndentationError, SyntaxError):
        pass
    return "\n".join(lines)


def docstring_lines(path):
    """Line numbers covered by a real docstring.

    Parsed with ast rather than tracked by hand: a hand-rolled "we are inside a
    docstring now" flag gets inverted as soon as one docstring's closing line
    fails the startswith() test — the next docstring's *opening* then reads as
    that previous one's *close*, and every docstring body after it gets scanned
    as if it were code. That false positive is exactly what this file is
    supposed to be immune to.
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    lines = set()
    holders = (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)
    for node in ast.walk(tree):
        if not isinstance(node, holders):
            continue
        body = getattr(node, "body", None)
        if not body:
            continue
        first = body[0]
        if (isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant)
                and isinstance(first.value.value, str)):
            lines.update(range(first.lineno, (first.end_lineno or first.lineno) + 1))
    return lines


def scan_sources():
    for p in sorted(CORE.glob("*.py")):
        if p.name == "i18n.py":
            continue
        skip = docstring_lines(p)
        original = p.read_text(encoding="utf-8").split("\n")
        stripped = strip_comments(p.read_text(encoding="utf-8")).split("\n")
        for i, raw in enumerate(stripped, 1):
            line = original[i - 1].strip()
            if not line.strip() or i in skip or line.startswith("#"):
                continue
            if CJK.search(raw):
                note(f"{p.name}:{i}", f"界面可见文案里有硬编码中文 → {line[:70]}")


# --- 2 & 3. 字典完整、占位符一致 -------------------------------------------
def scan_dict():
    for key, entry in sorted(i18n.MESSAGES.items()):
        if not isinstance(entry, dict):
            note("i18n.py", f"{key} 的值不是 dict")
            continue
        for lang in ("zh", "en"):
            if not entry.get(lang, "").strip():
                note("i18n.py", f"{key} 缺 {lang}（缺一边 = 英文界面退回中文）")
        zh_ph = sorted(PLACEHOLDER.findall(entry.get("zh", "")))
        en_ph = sorted(PLACEHOLDER.findall(entry.get("en", "")))
        if zh_ph != en_ph:
            note("i18n.py", f"{key} 占位符不一致：zh={zh_ph} en={en_ph}")


# --- 4. 英文输出里真的没有中文 ---------------------------------------------
A3 = [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]]
SINGULAR = [["1", "2", "3"], ["2", "4", "6"], ["1", "1", "1"]]
PROBES = [
    {"op": "det_cofactor", "A": A3, "showSteps": True},
    {"op": "det", "A": A3, "showSteps": True},
    {"op": "cofactor_matrix", "A": A3, "showSteps": True},
    {"op": "inverse", "A": A3, "showSteps": True},
    {"op": "ref", "A": A3, "showSteps": True},
    {"op": "lu", "A": A3, "showSteps": True},
    {"op": "solve", "A": [["2", "1"], ["1", "1"]], "B": [["3"], ["2"]],
     "showSteps": True},
    {"op": "multiply", "A": A3},                      # 缺 B → 报错
    {"op": "inverse", "A": SINGULAR, "showSteps": True},   # 奇异 → note
    {"op": "add", "A": [["1"]], "B": [["1"]], "showSteps": True},
    {"expr": "A**2", "matrices": {"A": A3}},           # 表达式报错
    {"expr": "inv(A)", "matrices": {"A": A3}, "showSteps": True},
    {"expr": "foo(A)", "matrices": {"A": A3}},
]


def _strings_in(result):
    """Every user-visible string in a dispatch result."""
    if not result.get("ok"):
        yield result.get("error") or ""
        return
    yield result.get("note") or ""
    for s in result.get("steps") or []:
        yield s.get("text") or ""


def scan_output():
    for probe in PROBES:
        req = dict(probe, lang="en")
        for text in _strings_in(engine.dispatch(req)):
            if text and CJK.search(text):
                key = probe.get("op") or f"expr {probe['expr']}"
                note("英文输出", f"{key} → {text[:70]}")
    # 顺带确认中文路径没被弄坏。但只在英文侧本来就有文案时才要求中文也有 ——
    # 有些运算（如 add）本来就不产生任何文字，两边都空是正常的。
    for probe in PROBES:
        en = [t for t in _strings_in(engine.dispatch(dict(probe, lang="en"))) if t.strip()]
        zh = [t for t in _strings_in(engine.dispatch(dict(probe, lang="zh"))) if t.strip()]
        if en and not zh:
            key = probe.get("op") or f"expr {probe['expr']}"
            note("中文输出", f"{key} 英文侧有文案、中文侧是空的")


scan_sources()
scan_dict()
scan_output()
i18n.set_lang("zh")

if problems:
    print("引擎文案检查未通过：\n")
    for p in problems:
        print("  -", p)
    print(f"\n共 {len(problems)} 处。处理办法：")
    print("  · 新文案 → 加进 core/i18n.py 的 MESSAGES（zh 与 en 都要写）")
    print("  · 占位符 → 两种语言必须一致，否则 .format 会抛异常")
    print("  · 英文输出漏中文 → 检查调用点有没有把 lang 传进来")
    sys.exit(1)

print(f"i18n 文案检查：core/ 无硬编码中文，字典 {len(i18n.MESSAGES)} 条双语齐全，"
      f"{len(PROBES)} 个探针的英文输出无中文残留 ✓")

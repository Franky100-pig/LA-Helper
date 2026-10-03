#!/usr/bin/env python3
"""验证 check_core_i18n.py 真的抓得住 —— 逐一还原四类问题，确认每次都 exit 1。

一个从没报过东西的检查器，和一个能抓 bug 的检查器，在绿灯时长得一模一样。
所以每加一条规则，就在这里造一个对应的坏情况，证明它会被抓到。
"""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CHECK = ROOT / "tools" / "check_core_i18n.py"
I18N = ROOT / "core" / "i18n.py"
MATRIX = ROOT / "core" / "matrix.py"
EXAMPLES = ROOT / "core" / "examples.py"
ENGINE = ROOT / "core" / "engine.py"

passed = 0
failures = []


def run():
    p = subprocess.run([sys.executable, str(CHECK)], capture_output=True, text=True,
                       cwd=str(ROOT))
    return p.returncode, p.stdout + p.stderr


def expect_clean(label):
    global passed
    code, out = run()
    if code == 0:
        passed += 1
    else:
        failures.append(f"{label}：当前代码本应是干净的，却 exit {code}\n{out[:400]}")


def expect_caught(label, needle, path, old, new):
    """把 path 里的 old 换成 new，确认检查器报出 needle，然后还原。"""
    global passed
    original = path.read_text(encoding="utf-8")
    if old not in original:
        failures.append(f"{label}：锚点没找到，测试自身失效 → {old[:60]!r}")
        return
    path.write_text(original.replace(old, new, 1), encoding="utf-8")
    try:
        code, out = run()
    finally:
        path.write_text(original, encoding="utf-8")
    if code != 0 and needle in out:
        passed += 1
    else:
        failures.append(f"{label}：应被报出（exit {code}，含 {needle!r}）\n{out[:400]}")


expect_clean("基线")

# 1. core/ 里新写回一句硬编码中文
expect_caught(
    "core/ 里出现硬编码中文",
    "硬编码中文",
    MATRIX,
    'raise ValueError(i18n.tr("err.matrix.cell_empty"))',
    'raise ValueError("这一格是空的")',
)

# 2. 字典只写了一种语言 —— 最常见的半成品
expect_caught(
    "字典缺英文",
    "缺 en",
    I18N,
    '"err.matrix.cell_empty": {\n        "zh": "单元格为空，请填 0 或删除该行/列",\n'
    '        "en": "This cell is empty — enter 0, or delete the row/column",\n    },',
    '"err.matrix.cell_empty": {\n        "zh": "单元格为空，请填 0 或删除该行/列",\n    },',
)

# 3. 占位符两种语言不一致 —— .format 会在学生面前抛异常
expect_caught(
    "占位符中英不一致",
    "占位符不一致",
    I18N,
    '"en": "Cell content too long (>{limit} characters): {preview}…"',
    '"en": "Cell content too long (>{limit} characters)…"',
)

# 4. 调用点忘了把语言传进来 —— 英文界面就会漏出中文步骤
expect_caught(
    "英文输出漏中文",
    "英文输出",
    ENGINE,
    '    i18n.set_lang(req.get("lang"))',
    "    pass  # 忘了设语言",
)

# 5. 讲义标题退回硬编码中文
expect_caught(
    "讲义标题硬编码中文",
    "硬编码中文",
    EXAMPLES,
    '"multiply": ("matmul", "note.matmul"),',
    '"multiply": ("matmul", "矩阵乘法为什么这么怪"),',
)

expect_clean("还原后")

print(f"core-i18n: {passed} 项通过，{len(failures)} 项失败")
if failures:
    print("FAIL")
    for f in failures:
        print("  -", f)
    sys.exit(1)
print("OK：检查器确实能抓住每一类引擎文案问题")

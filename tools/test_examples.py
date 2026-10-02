"""跑一遍 web/examples.js 里的每个示例，交给真正的 core 引擎算一次。

目的：示例数据是手写的，很容易出「矩阵形状对不上」「这个运算其实不成立」
（比如给一个奇异矩阵求逆）这类错误，而只有真跑过引擎才知道。
examples.js 是浏览器脚本，Python 读不了，所以先用 Node 求值导出 JSON
（tools/dump_examples.js），这里再喂给 core.engine.dispatch。
"""
import json
import pathlib
import re
import shutil
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core import engine  # noqa: E402

OPS_NEED_B = {"multiply", "add", "sub", "solve", "scalar"}

# 界面上存在的全部运算（web/app.js 的 op 下拉框 + 行列式的两种算法）
EXPECTED_OPS = {
    "multiply", "add", "sub", "transpose", "scalar", "inverse",
    "left_inverse", "right_inverse", "pseudo_inverse", "lu", "solve",
    "ref", "det", "cofactor_matrix", "rank", "eigen",
}

# 这些例子是故意「算不出」或「算出不好看」的，属于预期行为，不算失败
EXPECTED_NOT_OK = {"inverse": "示例里只有 startSingular 才是奇异矩阵；普通示例必须可逆"}


def load_examples() -> dict:
    node = shutil.which("node")
    if not node:
        raise SystemExit("需要 node 才能读取 examples.js")
    dumper = ROOT / "tools" / "dump_examples.js"
    out = subprocess.run(
        [node, str(dumper)], cwd=ROOT, capture_output=True, text=True, check=True,
    )
    return json.loads(out.stdout)


def check_shape(op: str, key: str, m) -> list:
    """网格渲染依赖「每行长度一致」，形状不自洽会画错。"""
    if not m:
        return [f"{op}.{key}: 矩阵为空"]
    if not all(len(row) == len(m[0]) for row in m):
        return [f"{op}.{key}: 行长度不一致 {m}"]
    if any(not isinstance(c, str) for row in m for c in row):
        return [f"{op}.{key}: 单元格必须是字符串（网格里存的就是字符串）"]
    return []


def main() -> int:
    ex_all = load_examples()
    ops = ex_all["ops"]
    failures: list[str] = []

    missing = EXPECTED_OPS - set(ops)
    if missing:
        failures.append(f"缺少示例的运算: {sorted(missing)}")
    extra = set(ops) - EXPECTED_OPS
    if extra:
        failures.append(f"示例里有未知运算: {sorted(extra)}")

    checked = 0
    for op in sorted(ops):
        ex = ops[op]
        failures += check_shape(op, "A", ex.get("A"))
        if "B" in ex:
            failures += check_shape(op, "B", ex.get("B"))

        if op in OPS_NEED_B:
            if "B" not in ex:
                failures.append(f"{op}: 需要第二个操作数但示例里没有 B")
                continue
        elif "B" in ex:
            failures.append(f"{op}: 用不到第二个操作数，示例里不该有 B")

        payload = {"op": op, "A": ex["A"], "showSteps": True}
        if op in OPS_NEED_B:
            payload["B"] = ex["B"]
        try:
            res = engine.dispatch(payload)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"{op}: 引擎抛异常 {type(exc).__name__}: {exc}")
            continue

        checked += 1
        if not res.get("ok"):
            note = EXPECTED_NOT_OK.get(op, "")
            failures.append(f"{op}: 引擎返回失败 -> {res.get('error')} {note}".strip())

    # 三个上手场景也都要能算（startSingular 除外，它就是要撞上「无逆」）
    for st in ex_all["starters"]:
        if "A" not in st or "op" not in st:
            failures.append(f"上手场景 {st.get('id')} 缺 op 或 A")
            continue
        payload = {"op": st["op"], "A": st["A"], "showSteps": True}
        if st["op"] in OPS_NEED_B:
            if "B" not in st:
                failures.append(f"上手场景 {st['id']} 需要 B")
                continue
            payload["B"] = st["B"]
        try:
            res = engine.dispatch(payload)
        except Exception as exc:  # noqa: BLE001
            failures.append(f"上手场景 {st['id']}: 引擎抛异常 {exc}")
            continue
        if st["id"] == "startSingular":
            # 奇异矩阵求逆必须走 inverse_status（而不是抛错），且 exists=False，
            # 否则这个上手场景只会给新用户一句看不懂的英文异常
            if res.get("type") != "inverse_status" or res.get("exists") is not False:
                failures.append(f"startSingular: 应当返回「无逆」，实际 {res}")
        elif not res.get("ok"):
            failures.append(f"上手场景 {st['id']}: {res.get('error')}")

    # 讲义映射：引用的 id 必须真的存在于 notes.js，且标题不能漂移
    notes_src = (ROOT / "web" / "notes.js").read_text(encoding="utf-8")
    note_ids = set(re.findall(r'id: "([^"]+)"', notes_src))
    titles: dict[str, set[str]] = {}
    for m in re.finditer(r'id: "([^"]+)",\s*\n\s*title: "([^"]+)"', notes_src):
        titles.setdefault(m.group(1), set()).add(m.group(2))

    arts = dict(ex_all["articles"])
    for k, v in ex_all["detArticles"].items():
        arts[f"det:{k}"] = v
    for key, art in arts.items():
        if art["id"] not in note_ids:
            failures.append(f"讲义映射 {key}: notes.js 里没有 id={art['id']}")
            continue
        for lang in ("zh", "en"):
            t = art["title"][lang]
            if t not in titles.get(art["id"], set()):
                failures.append(f"讲义映射 {key}: {lang} 标题与 notes.js 不一致 -> {t!r}")

    print(f"examples: 跑了 {checked}/{len(EXPECTED_OPS)} 个运算，"
          f"{len(ex_all['starters'])} 个上手场景，{len(arts)} 条讲义映射")
    if failures:
        print("FAIL")
        for f in failures:
            print("  -", f)
        return 1
    print("OK：每个运算都有可算的示例，标题未漂移")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

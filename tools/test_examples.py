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

from core import engine, examples as core_ex   # noqa: E402

OPS_NEED_B = core_ex.OPS_NEED_B

# 界面上存在的全部运算（web/app.js 的 op 下拉框 + 桌面端 OPS）
EXPECTED_OPS = {
    "multiply", "add", "sub", "transpose", "scalar", "inverse",
    "left_inverse", "right_inverse", "pseudo_inverse", "lu", "solve",
    "ref", "det", "cofactor_matrix", "rank", "eigen",
}

# 这些例子是故意「算不出」的，属于预期行为，不算失败。
# startSingular（奇异矩阵求逆）单独校验：必须返回「无逆」而不是抛错。
EXPECTED_NOT_OK = set()


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


def check_js_matches_core(js_ex: dict) -> list:
    """web/examples.js 必须和 core/examples.py 一模一样。

    桌面端直接 import core.examples，网页端读的是 JS 副本。两边一旦漂移，
    同一个运算在两个版本里给出的示例就不同 —— 这类问题只有对照着才看得出来，
    所以在这里钉死。
    """
    fails = []
    for op in sorted(set(core_ex.EXAMPLES) | set(js_ex.get("ops", {}))):
        want = core_ex.EXAMPLES.get(op)
        got = js_ex.get("ops", {}).get(op)
        if want is None:
            fails.append(f"[js/core] JS 里有 core 没有的运算: {op}")
            continue
        if got is None:
            fails.append(f"[js/core] JS 缺运算: {op}")
            continue
        for key in ("A", "B", "left", "right"):
            if want.get(key) != got.get(key):
                fails.append(f"[js/core] {op}.{key}: core={want.get(key)!r} js={got.get(key)!r}")

    # 讲义映射：id 与中英两种标题都要一致
    js_arts = dict(js_ex.get("articles", {}))
    for method, v in js_ex.get("detArticles", {}).items():
        js_arts[f"det:{method}"] = v
    all_arts = {k: (v[0], v[1]) for k, v in core_ex.ARTICLES.items()}
    all_arts.update({f"det:{k}": v for k, v in core_ex.DET_ARTICLES.items()})
    for key, want in all_arts.items():
        got = js_arts.get(key)
        if got is None:
            fails.append(f"[js/core] JS 缺讲义映射: {key}")
            continue
        if got["id"] != want[0]:
            fails.append(f"[js/core] {key} 讲义 id: core={want[0]} js={got['id']}")
        if got["title"]["zh"] != want[1]:
            fails.append(f"[js/core] {key} 中文标题: core={want[1]!r} js={got['title']['zh']!r}")
        # 英文标题也要在（core 只有中文，英文的唯一真相在 notes.js，
        # 那一侧由下面 check_js_against_notes 校验）
        if not (got.get("title", {}).get("en") or "").strip():
            fails.append(f"[js/core] {key} 英文标题为空 —— 英文界面会显示空白")

    # 三个上手场景
    js_start = {s["id"]: s for s in js_ex.get("starters", [])}
    for st in core_ex.STARTERS:
        got = js_start.get(st["id"])
        if got is None:
            fails.append(f"[js/core] JS 缺上手场景: {st['id']}")
            continue
        for key in ("op", "A", "B", "left", "right", "detMethod"):
            if st.get(key) != got.get(key):
                fails.append(f"[js/core] 场景 {st['id']}.{key}: "
                             f"core={st.get(key)!r} js={got.get(key)!r}")
    extra = set(js_start) - {s["id"] for s in core_ex.STARTERS}
    if extra:
        fails.append(f"[js/core] JS 里有 core 没有的场景: {sorted(extra)}")
    return fails


def main() -> int:
    js_ex = load_examples()
    ops = core_ex.EXAMPLES
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
        if not res.get("ok") and op not in EXPECTED_NOT_OK:
            failures.append(f"{op}: 引擎返回失败 -> {res.get('error')}")

    # 三个上手场景也都要能算（startSingular 除外，它就是要撞上「无逆」）
    for st in core_ex.STARTERS:
        if "A" not in st or "op" not in st:
            failures.append(f"上手场景 {st.get('id')} 缺 op 或 A")
            continue
        payload = {"op": st["op"], "A": st["A"], "showSteps": True}
        if st["op"] == "det" and st.get("detMethod") == "cofactor":
            payload["op"] = "det_cofactor"
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

    # web/examples.js 是 core/examples.py 的副本 —— 两边必须一模一样
    failures += check_js_matches_core(js_ex)

    # 讲义映射：引用的 id 必须真的存在于 notes.js，且标题不能漂移
    notes_src = (ROOT / "web" / "notes.js").read_text(encoding="utf-8")
    note_ids = set(re.findall(r'id: "([^"]+)"', notes_src))

    # 按语言分开收集标题。之前是把同一 id 的中英标题塞进**同一个 set**，
    # 于是「英文槽位里放了中文标题」这种跨语言串位也能通过 —— 英文界面
    # 就会显示中文，而你以为它是校验过的。这里按 zh/en 分段切开。
    def _titles_by_lang(lang: str) -> dict:
        # 取 `  zh: [` 到 `  en: [`（或文件尾）之间的片段
        start = notes_src.index(f"\n  {lang}: [")
        rest = notes_src[start + 1:]
        nxt = re.search(r"\n  (?:zh|en): \[", rest[1:])
        seg = rest[:nxt.start() + 1] if nxt else rest
        out = {}
        for m in re.finditer(r'id:\s*"([^"]+)",\s*\n\s*title:\s*"([^"]+)"', seg):
            out.setdefault(m.group(1), set()).add(m.group(2))
        return out

    titles_by_lang = {"zh": _titles_by_lang("zh"), "en": _titles_by_lang("en")}
    for lang, t in titles_by_lang.items():
        if not t:
            failures.append(f"notes.js: 没能解析出 {lang} 的讲义标题（结构变了？）")

    arts = dict(js_ex.get("articles", {}))
    for k, v in js_ex.get("detArticles", {}).items():
        arts[f"det:{k}"] = v
    for key, art in arts.items():
        if art["id"] not in note_ids:
            failures.append(f"讲义映射 {key}: notes.js 里没有 id={art['id']}")
            continue
        for lang in ("zh", "en"):
            t = art["title"][lang]
            pool = titles_by_lang[lang].get(art["id"], set())
            if t not in pool:
                failures.append(
                    f"讲义映射 {key}: {lang} 标题与 notes.js 的 {lang} 段不一致 -> {t!r}")

    print(f"examples: core 跑了 {checked}/{len(EXPECTED_OPS)} 个运算，"
          f"{len(core_ex.STARTERS)} 个上手场景，{len(arts)} 条讲义映射；"
          f"js/core 一致性已核对")
    if failures:
        print("FAIL")
        for f in failures:
            print("  -", f)
        return 1
    print("OK：每个运算都有可算的示例，web 与 core 数据一致，标题未漂移")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

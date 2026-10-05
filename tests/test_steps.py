"""Steps must carry the matrix that results from each row operation — and enough
structure for a UI to drive playback and highlighting without parsing prose.

Every recorded step is::

    {"text": <row operation>,      # already localized
     "matrix": <snapshot>,         # state *after* this step, or None
     "op": <kind>,                 # "swap" / "scale" / "eliminate" / "expand" / "note"
     "pivot": {"row", "col", "value"} | None,
     "rows": [<0-based row indices touched>]}

``text`` alone would force a UI to parse English or Chinese prose to find out
what happened — which breaks the moment the wording changes. ``op``/``pivot``/
``rows`` are the machine-readable half, and the roadmap item this serves is
"每步带矩阵快照与当前主元，支持单步播放 / 高亮".

Purely explanatory steps (det(A) = det(P)·det(L)·det(U), "singular", pinv
special cases, ...) carry ``matrix: None`` and ``op: "note"``.
"""
from core import engine, format_math

STEP_KEYS = {"text", "matrix", "op", "pivot", "rows"}
ROW_OPS = {"swap", "scale", "eliminate"}


def _dispatch(op, A, B=None, **kw):
    req = {"op": op, "A": A, "showSteps": True}
    if B is not None:
        req["B"] = B
    req.update(kw)
    res = engine.dispatch(req)
    assert res.get("ok"), res
    return res


def _assert_shape_of_step(s):
    """A step is a dict with a non-empty text and either None or a string grid."""
    assert isinstance(s, dict), f"step should be a dict, got {type(s).__name__}"
    assert isinstance(s["text"], str) and s["text"]
    assert set(s) == STEP_KEYS
    assert s["op"] in {"swap", "scale", "eliminate", "expand", "note", None}, s["op"]
    assert isinstance(s["rows"], list) and all(
        isinstance(i, int) and i >= 0 for i in s["rows"]), s["rows"]
    if s["pivot"] is not None:
        p = s["pivot"]
        assert set(p) == {"row", "col", "value"}, p
        assert isinstance(p["row"], int) and p["row"] >= 0
        assert isinstance(p["col"], int) and p["col"] >= 0
    m = s["matrix"]
    if m is not None:
        assert isinstance(m, list) and m
        width = len(m[0])
        for row in m:
            assert len(row) == width
            assert all(isinstance(c, str) for c in row)


A3 = [[2, 1, 1], [4, 1, 3], [-2, 2, 1]]


def test_ref_steps_each_carry_matrix_and_last_is_the_result():
    res = _dispatch("ref", A3)
    assert res["steps"], "REF should record steps for this matrix"
    for s in res["steps"]:
        _assert_shape_of_step(s)
        assert s["matrix"] is not None
    # 最后一步之后矩阵不再变化 → 快照就等于最终 REF 结果
    assert res["steps"][-1]["matrix"] == res["data"]


def test_inverse_steps_track_the_augmented_matrix():
    res = _dispatch("inverse", A3)
    n = 3
    for s in res["steps"]:
        _assert_shape_of_step(s)
        assert len(s["matrix"][0]) == 2 * n          # [A | I]
    # 末态左半边是单位阵，右半边就是求出来的逆
    last = res["steps"][-1]["matrix"]
    assert [row[:n] for row in last] == [["1", "0", "0"], ["0", "1", "0"], ["0", "0", "1"]]
    assert [row[n:] for row in last] == res["data"]


def test_lu_elimination_steps_end_at_u():
    res = _dispatch("lu", A3)
    assert res["steps"]
    for s in res["steps"]:
        _assert_shape_of_step(s)
        assert s["matrix"] is not None
    # 消元结束后就是 U
    assert res["steps"][-1]["matrix"] == res["U"]


def test_solve_steps_show_the_augmented_matrix():
    res = _dispatch("solve", A3, [[1], [2], [3]])
    assert res["steps"]
    for s in res["steps"]:
        _assert_shape_of_step(s)
        assert len(s["matrix"][0]) == 3 + 1          # [A | b]


def test_det_has_text_only_steps_without_matrix():
    res = _dispatch("det", A3)
    assert res["steps"]
    text_only = [s for s in res["steps"] if s["matrix"] is None]
    assert text_only, "the explanatory det steps should have no matrix"
    assert any("det(A)" in s["text"] for s in text_only)
    for s in res["steps"]:
        _assert_shape_of_step(s)


def test_pseudo_inverse_explanation_step_is_text_only():
    res = _dispatch("pseudo_inverse", [[1, 2], [3, 4], [5, 6]])
    assert res["steps"]
    for s in res["steps"]:
        _assert_shape_of_step(s)
    assert res["steps"][0]["matrix"] is None


def test_no_steps_when_disabled():
    res = engine.dispatch({"op": "ref", "A": A3, "showSteps": False})
    assert res["steps"] == []


# ---- structured metadata (playback + highlighting) ------------------------
def test_ref_steps_are_all_typed_row_operations_with_a_pivot():
    """REF is the canonical case: every step is an elimination, pivots march
    down the diagonal, and each step names the row it changed."""
    res = _dispatch("ref", A3)
    ops = {s["op"] for s in res["steps"]}
    assert ops <= ROW_OPS, f"REF 只应产生行变换，实际有 {ops}"
    for s in res["steps"]:
        assert s["pivot"] is not None, f"缺少主元: {s['text']}"
        assert len(s["rows"]) == 1, f"消元只动一行: {s}"
        # 消元动的那一行必须在主元之下
        assert s["rows"][0] > s["pivot"]["row"]


def test_pivot_columns_advance_left_to_right():
    """Playback walks the pivots in order — that ordering is what a UI animates,
    so it has to be a property of the data, not of the rendering."""
    res = _dispatch("ref", A3)
    cols = [s["pivot"]["col"] for s in res["steps"]]
    assert cols == sorted(cols), f"主元列应递增: {cols}"


def test_a_forced_swap_is_reported_as_a_swap_naming_both_rows():
    """A leading zero forces a swap; the step must say so structurally rather
    than leaving the UI to parse it out of the prose."""
    res = _dispatch("ref", [[0, 1, 2], [1, 0, 1], [1, 1, 0]])
    swaps = [s for s in res["steps"] if s["op"] == "swap"]
    assert swaps, "首元素为 0 时应记录一次交换"
    assert sorted(swaps[0]["rows"]) == [0, 1]
    assert swaps[0]["matrix"] is not None


def test_pseudo_inverse_notes_are_typed_as_note_with_no_pivot():
    res = _dispatch("pseudo_inverse", [[1, 2], [3, 4], [5, 6]])
    assert res["steps"][0]["op"] == "note"
    assert res["steps"][0]["pivot"] is None
    assert res["steps"][0]["rows"] == []


def test_metadata_survives_both_languages():
    """Structure must not depend on the language — a UI cannot special-case zh."""
    zh = _dispatch("ref", A3, lang="zh")["steps"]
    en = _dispatch("ref", A3, lang="en")["steps"]
    assert [(s["op"], s["pivot"], s["rows"]) for s in zh] == \
           [(s["op"], s["pivot"], s["rows"]) for s in en]


# ---- formatter tolerance ---------------------------------------------------
def test_step_formatters_accept_dict_and_plain_string():
    d = {"text": "R1 → R1 / (2)", "matrix": [["1"]]}
    assert format_math.step_text(d) == "R1 → R1 / (2)"
    assert format_math.step_text("R1 → R1 / (2)") == "R1 → R1 / (2)"
    html = format_math.step_html(d)
    assert "R1" in html and "undefined" not in html
    # 分数排版仍然生效
    assert "frac" in format_math.step_html({"text": "R1 → R1 / (2/3)"})

"""Steps must carry the matrix that results from each row operation.

Every recorded step is ``{"text": <row operation>, "matrix": <snapshot>}`` so
both editions can show "the matrix right after this step" underneath it.
Purely explanatory steps (det(A) = det(P)·det(L)·det(U), "singular", pinv
special cases, ...) carry ``matrix: None``.
"""
from core import engine, format_math


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
    assert set(s) == {"text", "matrix"}
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


# ---- formatter tolerance ---------------------------------------------------
def test_step_formatters_accept_dict_and_plain_string():
    d = {"text": "R1 → R1 / (2)", "matrix": [["1"]]}
    assert format_math.step_text(d) == "R1 → R1 / (2)"
    assert format_math.step_text("R1 → R1 / (2)") == "R1 → R1 / (2)"
    html = format_math.step_html(d)
    assert "R1" in html and "undefined" not in html
    # 分数排版仍然生效
    assert "frac" in format_math.step_html({"text": "R1 → R1 / (2/3)"})

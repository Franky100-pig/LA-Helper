"""Determinant by cofactor expansion: same value, hand-followable steps.

`core.det_rank.determinant(..., method="cofactor")` expands along the
row/column with the most zeros and records every minor, so the working can be
followed on paper. These tests pin the value (it must agree with the
row-reduction path), the step shape, the zero-picking, and the size cap.
"""
import pytest

from core import engine
from core.det_rank import MAX_COFACTOR_DIM, determinant
from core.matrix import Matrix

SAMPLES = {
    "1x1": [[7]],
    "2x2": [[1, 2], [3, 4]],
    "3x3": [[2, 1, 1], [4, 1, 3], [-2, 2, 1]],
    "3x3-singular": [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
    "4x4": [[1, 2, 3, 4], [5, 6, 7, 8], [2, 6, 4, 8], [3, 1, 1, 2]],
    "with-zeros": [[1, 0, 3], [0, 0, 2], [4, 5, 6]],
    "fractions": [["1/2", "1/3"], ["1/4", "1/5"]],
}


@pytest.mark.parametrize("name", sorted(SAMPLES))
def test_cofactor_matches_row_reduction(name):
    A = Matrix(SAMPLES[name])
    cof = determinant(A, method="cofactor")[0]
    row = determinant(A, method="row_reduction")[0]
    assert cof == row


def test_known_values():
    assert determinant(Matrix([[1, 2], [3, 4]]), method="cofactor")[0] == -2
    assert determinant(Matrix([[2, 1, 1], [4, 1, 3], [-2, 2, 1]]),
                       method="cofactor")[0] == -10
    assert determinant(Matrix([[1, 2, 3], [4, 5, 6], [7, 8, 9]]),
                       method="cofactor")[0] == 0


def test_symbolic_cofactor_uses_the_familiar_formula():
    A = Matrix([["a", "b"], ["c", "d"]], allow_symbols=True)
    d = determinant(A, method="cofactor")[0]
    assert str(d) == "a*d - b*c"


def test_steps_are_well_formed_and_end_with_the_value():
    res = engine.dispatch({"op": "det_cofactor",
                           "A": SAMPLES["3x3"], "showSteps": True})
    assert res["ok"] and res["type"] == "scalar"
    steps = res["steps"]
    assert steps
    for s in steps:
        assert set(s) == {"text", "matrix"}
        assert isinstance(s["text"], str) and s["text"]
        if s["matrix"] is not None:
            assert all(isinstance(c, str) for row in s["matrix"] for c in row)
    # 第一步就是原矩阵，最后一步给出结论
    assert steps[0]["matrix"] == Matrix(SAMPLES["3x3"]).to_list()
    assert steps[-1]["text"].startswith("det(A) = ")
    assert any("展开" in s["text"] for s in steps)


def test_expands_along_the_row_with_most_zeros():
    # 第 2 行有 2 个 0 → 应该挑它，非零项只剩 (2,3)
    res = engine.dispatch({"op": "det_cofactor",
                           "A": SAMPLES["with-zeros"], "showSteps": True})
    assert "沿第 2 行展开" in res["steps"][0]["text"]
    term_steps = [s for s in res["steps"] if s["text"].lstrip("· ").startswith("项 (")]
    # 顶层只展开 (2,3) 一项；其 2×2 余子式 [[1,0],[4,5]] 再挑含 0 的第 1 行，
    # 于是嵌套层也只剩 (1,1) 一项 —— 共 2 个项步骤。
    assert len(term_steps) == 2
    assert "项 (2,3)" in res["steps"][1]["text"]
    assert res["steps"][1]["matrix"] == [["1", "0"], ["4", "5"]]


def test_single_entry_matrix():
    res = engine.dispatch({"op": "det_cofactor", "A": [[7]], "showSteps": True})
    assert res["value"] == "7"
    assert any("1×1" in s["text"] for s in res["steps"])


def test_no_steps_when_disabled():
    res = engine.dispatch({"op": "det_cofactor",
                           "A": SAMPLES["3x3"], "showSteps": False})
    assert res["steps"] == []
    assert res["value"] == "-10"


def test_size_cap_gives_a_helpful_error():
    big = [[2] * (MAX_COFACTOR_DIM + 1) for _ in range(MAX_COFACTOR_DIM + 1)]
    res = engine.dispatch({"op": "det_cofactor", "A": big, "showSteps": True})
    assert res["ok"] is False
    assert "行变换" in res["error"]
    with pytest.raises(ValueError):
        determinant(Matrix(big), method="cofactor")


def test_non_square_is_rejected():
    res = engine.dispatch({"op": "det_cofactor",
                           "A": [[1, 2, 3], [4, 5, 6]], "showSteps": True})
    assert res["ok"] is False


def test_expression_cofactor_matches_the_dropdown_op():
    lib = {"A": SAMPLES["3x3"]}
    expr = engine.dispatch({"expr": "cofactor(A)", "matrices": lib,
                            "showSteps": True})
    assert expr == engine.dispatch({"op": "det_cofactor",
                                    "A": SAMPLES["3x3"], "showSteps": True})
    # 与 det(A) 的数值一致，只是步骤不同
    plain = engine.dispatch({"expr": "det(A)", "matrices": lib, "showSteps": True})
    assert expr["value"] == plain["value"]
    assert expr["steps"] != plain["steps"]


def test_expression_cofactor_composes_like_det():
    lib = {"A": [[1, 2], [3, 4]]}
    res = engine.dispatch({"expr": "cofactor(A) + 10", "matrices": lib})
    assert res["ok"] and res["value"] == "8"       # -2 + 10

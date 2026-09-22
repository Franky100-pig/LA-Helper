"""Cofactor matrix C and adjugate adj(A) = Cᵀ.

`core.det_rank.cofactor_matrix` returns the cofactor matrix C, its transpose
(the adjugate), and det(A). These tests pin the definition C(i,j)=(−1)^(i+j)·M(i,j),
the transpose relationship, a couple of known values, the non-square / size-cap
guards, and the engine result envelope.
"""
import pytest
import sympy as sp

from core import engine
from core.det_rank import MAX_COFACTOR_DIM, cofactor_matrix
from core.matrix import Matrix

A2 = [[1, 2], [3, 4]]
A3I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def _simplify_eq(a, b):
    return sp.simplify(a) == sp.simplify(b)


def test_2x2_cofactor_and_adjugate():
    C, adj, det, _ = cofactor_matrix(Matrix(A2), record_steps=False)
    # C = [[4, -3], [-2, 1]]
    assert _simplify_eq(C[0][0], 4) and _simplify_eq(C[0][1], -3)
    assert _simplify_eq(C[1][0], -2) and _simplify_eq(C[1][1], 1)
    # adj = Cᵀ = [[4, -2], [-3, 1]]
    assert _simplify_eq(adj[0][0], 4) and _simplify_eq(adj[0][1], -2)
    assert _simplify_eq(adj[1][0], -3) and _simplify_eq(adj[1][1], 1)
    # adj(A) = det(A)·A⁻¹；det = 1*4 - 2*3 = -2
    assert _simplify_eq(det, -2)


def test_identity_3x3():
    C, adj, det, _ = cofactor_matrix(Matrix(A3I), record_steps=False)
    for i in range(3):
        for j in range(3):
            expect = 1 if i == j else 0
            assert _simplify_eq(C[i][j], expect)
            assert _simplify_eq(adj[i][j], expect)
    assert _simplify_eq(det, 1)


def test_adjugate_is_transpose_of_cofactor():
    A = Matrix([[2, 1, 1], [4, 1, 3], [-2, 2, 1]])
    C, adj, _, _ = cofactor_matrix(A, record_steps=False)
    for i in range(3):
        for j in range(3):
            assert _simplify_eq(adj[j][i], C[i][j])


def test_non_square_rejected():
    res = engine.dispatch({"op": "cofactor_matrix",
                           "A": [[1, 2, 3], [4, 5, 6]], "showSteps": False})
    assert res["ok"] is False


def test_size_cap_gives_helpful_error():
    big = [[2] * (MAX_COFACTOR_DIM + 1) for _ in range(MAX_COFACTOR_DIM + 1)]
    res = engine.dispatch({"op": "cofactor_matrix", "A": big, "showSteps": False})
    assert res["ok"] is False
    assert "方阵求逆" in res["error"]
    with pytest.raises(ValueError):
        cofactor_matrix(Matrix(big), record_steps=False)


def test_engine_envelope():
    res = engine.dispatch({"op": "cofactor_matrix", "A": A2, "showSteps": False})
    assert res["ok"] and res["type"] == "cofactor"
    assert res["C"][0][0] == "4" and res["C"][0][1] == "-3"
    # adj = Cᵀ
    assert res["adj"][0][1] == "-2" and res["adj"][1][0] == "-3"
    assert res["det"] == "-2"
    assert res["steps"] == []


def test_steps_when_enabled_are_well_formed():
    res = engine.dispatch({"op": "cofactor_matrix", "A": A2, "showSteps": True})
    assert res["ok"] and res["steps"]
    for s in res["steps"]:
        assert set(s) == {"text", "matrix"}
        assert isinstance(s["text"], str) and s["text"]
        # 每个余子式步骤都带着它对应的余子式小矩阵
        if s["matrix"] is not None:
            assert all(isinstance(c, str) for row in s["matrix"] for c in row)
    # 最后一个步骤给出伴随矩阵提示
    assert "adj(A) = Cᵀ" in res["steps"][-1]["text"]

"""Gram-Schmidt / QR regression tests.

The calculator must return a genuine orthonormal Q, an upper-triangular R
that reconstructs the original matrix, and a clear error when a column is
dependent (the remainder collapses to zero).
"""
import sympy as sp

from core.engine import dispatch


A = [["2", "1"], ["1", "2"]]
QR_A = [["1", "2"], ["1", "0"]]


def _sym(matrix):
    return sp.Matrix([[sp.sympify(cell) for cell in row] for row in matrix])


def test_gram_schmidt_returns_orthogonal_and_orthonormal_columns():
    res = dispatch({"op": "gram_schmidt", "A": A, "showSteps": False})
    assert res["ok"], res.get("error")
    assert res["type"] == "gram_schmidt"
    B, Q = _sym(res["B"]), _sym(res["Q"])
    assert sp.simplify(B[:, 0].dot(B[:, 1])) == 0
    assert sp.simplify(Q.T * Q) == sp.eye(2)


def test_qr_reconstructs_matrix_and_r_is_upper_triangular():
    res = dispatch({"op": "qr", "A": QR_A, "showSteps": False})
    assert res["ok"], res.get("error")
    assert res["type"] == "qr"
    Q, R = _sym(res["Q"]), _sym(res["R"])
    assert sp.simplify(Q.T * Q) == sp.eye(2)
    assert R[1, 0] == 0
    assert sp.simplify(Q * R - sp.Matrix([[1, 2], [1, 0]])) == sp.zeros(2, 2)


def test_expression_aliases_reach_the_same_operations():
    for expr, want in (("qr(A)", "qr"), ("gs(A)", "gram_schmidt")):
        res = dispatch({"expr": expr, "matrices": {"A": QR_A},
                        "showSteps": False})
        assert res["ok"], res.get("error")
        assert res["type"] == want


def test_dependent_columns_are_reported_not_crashed():
    res = dispatch({"op": "qr", "A": [["1", "2"], ["2", "4"]],
                    "showSteps": False})
    assert not res["ok"]
    assert "dependent" in res["error"].lower() or "相关" in res["error"]

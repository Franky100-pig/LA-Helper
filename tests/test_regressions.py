"""Regression tests for issues found during code review."""
import sympy as sp
import pytest

from core.matrix import Matrix
from core import lu, det_rank, eigen, ops, inverse as inv


# 1. LU must not crash on symbolic entries, and must produce a clean U.

def test_lu_symbolic_does_not_crash():
    A = Matrix([["a", "b"], ["c", "d"]], allow_symbols=True)
    P, L, U, swaps, _ = lu.lu_decomposition(A, pivot=True, record_steps=False)
    assert ops.mul(P, A).to_list() == ops.mul(L, U).to_list()


def test_lu_u_is_upper_triangular():
    A = Matrix([[sp.Rational(1, 3), 2, 5], [7, sp.Rational(1, 7), 3],
                [4, 9, sp.Rational(2, 5)]])
    _, _, U, _, _ = lu.lu_decomposition(A, record_steps=False)
    for i in range(3):
        for j in range(i):
            assert U.data[i][j] == 0


# 2. Determinant: singular, symbolic and pivoted cases.

def test_det_singular_is_zero():
    d, _ = det_rank.determinant(Matrix([[1, 2], [2, 4]]), record_steps=False)
    assert d == 0


def test_det_symbolic():
    A = Matrix([["a", "b"], ["c", "d"]], allow_symbols=True)
    d, _ = det_rank.determinant(A, record_steps=False)
    assert sp.simplify(d - (sp.Symbol("a") * sp.Symbol("d")
                            - sp.Symbol("b") * sp.Symbol("c"))) == 0


def test_det_matches_sympy_on_random_matrices():
    import random
    random.seed(7)
    for _ in range(10):
        n = random.randint(2, 5)
        data = [[random.randint(-9, 9) for _ in range(n)] for _ in range(n)]
        d, _ = det_rank.determinant(Matrix(data), record_steps=False)
        assert sp.simplify(d - sp.Matrix(data).det()) == 0


# 3. Input whitelist.

@pytest.mark.parametrize("bad", ["9**9**9", "__import__('os')", "sqrt(2)",
                                 "1;2", "a", "", "1 2"])
def test_unsafe_cells_are_rejected(bad):
    with pytest.raises(ValueError):
        Matrix([[bad]])


@pytest.mark.parametrize("good,expected", [("1/3", "1/3"), ("-2", "-2"),
                                           ("0.5", "1/2"), ("1e-3", "1/1000")])
def test_valid_cells_are_parsed(good, expected):
    assert Matrix([[good]]).to_list() == [[expected]]


def test_float_is_not_silently_rounded_away():
    """1e-11 used to become 0 via limit_denominator."""
    assert Matrix([[1e-11]]).to_list() == [["1/100000000000"]]


def test_ragged_rows_raise():
    with pytest.raises(ValueError):
        Matrix([[1, 2], [3]])


def test_non_list_row_raises():
    with pytest.raises(ValueError):
        Matrix([[1, 2], 3])


# 4. Eigen: readable output instead of CRootOf.

def test_eigen_small_stays_exact():
    pairs = eigen.eigen(Matrix([[2, 0], [0, 3]]))
    assert sorted(p["value"] for p in pairs) == ["2", "3"]


def test_eigen_defective_flag():
    pairs = eigen.eigen(Matrix([[1, 1], [0, 1]]))
    assert pairs[0]["multiplicity"] == 2
    assert pairs[0]["geometric"] == 1
    assert pairs[0]["defective"] is True


def test_eigen_large_matrix_is_readable_and_quick():
    """Used to return CRootOf(...) after ~20s of frozen UI."""
    import random
    import time
    random.seed(11)
    n = 6
    data = [[random.randint(-5, 5) for _ in range(n)] for _ in range(n)]
    start = time.time()
    pairs = eigen.eigen(Matrix(data))
    assert time.time() - start < 5
    assert len(pairs) == n
    for p in pairs:
        assert "CRootOf" not in p["value"]


# 5. Pseudoinverse keeps the Moore-Penrose property A·A⁺·A = A.

def test_pinv_moore_penrose():
    A = Matrix([[1, 2], [2, 4], [3, 1]])
    P, _ = inv.pseudo_inverse(A, record_steps=False)
    assert ops.mul(ops.mul(A, P), A).to_list() == A.to_list()

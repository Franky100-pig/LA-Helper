import pytest
from core.matrix import Matrix
from core import inverse as inv, ops


def test_inverse_2x2():
    A = Matrix([[1, 2], [3, 4]])
    R, _ = inv.inverse(A)
    assert R.to_list() == [["-2", "1"], ["3/2", "-1/2"]]


def test_inverse_aa_inv_is_I():
    A = Matrix([[4, 7], [2, 6]])
    R, _ = inv.inverse(A)
    assert ops.mul(A, R).to_list() == [["1", "0"], ["0", "1"]]


def test_singular_raises():
    with pytest.raises(ValueError):
        inv.inverse(Matrix([[1, 2], [2, 4]]))


def test_left_inverse():
    A = Matrix([[1, 0], [0, 1], [1, 1]])  # 3x2, full column rank
    L, _ = inv.left_inverse(A)
    assert L.shape == (2, 3)
    assert ops.mul(L, A).to_list() == [["1", "0"], ["0", "1"]]


def test_left_inverse_rank_fail():
    A = Matrix([[1, 2], [2, 4], [3, 6]])  # rank 1 < 2
    L, note = inv.left_inverse(A)
    assert L is None


def test_right_inverse():
    A = Matrix([[1, 0, 1], [0, 1, 1]])  # 2x3, full row rank
    R, _ = inv.right_inverse(A)
    assert R.shape == (3, 2)
    assert ops.mul(A, R).to_list() == [["1", "0"], ["0", "1"]]


def test_pseudo_square_equals_inverse():
    A = Matrix([[1, 2], [3, 4]])
    P, _ = inv.pseudo_inverse(A)
    assert ops.mul(A, P).to_list() == [["1", "0"], ["0", "1"]]

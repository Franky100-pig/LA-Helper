import pytest
from core.matrix import Matrix
from core import ops


def test_add():
    A = Matrix([[1, 2], [3, 4]])
    B = Matrix([[5, 6], [7, 8]])
    assert ops.add(A, B).to_list() == [["6", "8"], ["10", "12"]]


def test_sub():
    A = Matrix([[5, 6], [7, 8]])
    B = Matrix([[1, 2], [3, 4]])
    assert ops.sub(A, B).to_list() == [["4", "4"], ["4", "4"]]


def test_mul():
    A = Matrix([[1, 2], [3, 4]])
    B = Matrix([[5, 6], [7, 8]])
    # [[19, 22], [43, 50]]
    assert ops.mul(A, B).to_list() == [["19", "22"], ["43", "50"]]


def test_mul_dim_error():
    with pytest.raises(ValueError):
        ops.mul(Matrix([[1, 2]]), Matrix([[1, 2]]))


def test_mul_max_dim_guard():
    big = [[1] * 16 for _ in range(16)]
    A = Matrix(big)
    B = Matrix(big)
    R = ops.mul(A, B)
    assert R.shape == (16, 16)

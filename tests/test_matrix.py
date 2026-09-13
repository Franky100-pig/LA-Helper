import pytest
from core.matrix import Matrix


def test_shape():
    assert Matrix([[1, 2], [3, 4]]).shape == (2, 2)


def test_ragged_raises():
    with pytest.raises(ValueError):
        Matrix([[1, 2], [3]])


def test_to_list_exact():
    assert Matrix([[1, 2], [3, 4]]).to_list() == [["1", "2"], ["3", "4"]]


def test_rational_preserved():
    assert Matrix([["1/3", 2]]).to_list() == [["1/3", "2"]]


def test_transpose_shape():
    assert Matrix([[1, 2, 3], [4, 5, 6]]).transpose().to_list() == \
        [["1", "4"], ["2", "5"], ["3", "6"]]

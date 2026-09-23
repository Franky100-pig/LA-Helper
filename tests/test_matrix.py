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


def test_zero_denominator_message_is_user_readable():
    """"1/0" passes the numeric whitelist but must not leak SymPy internals.

    It used to surface "string-float not recognized: 1/0", which means nothing
    to a student.
    """
    with pytest.raises(ValueError) as exc:
        Matrix([["1/0", "2"], ["3", "4"]])
    msg = str(exc.value)
    assert "分母不能为 0" in msg
    assert "string-float" not in msg

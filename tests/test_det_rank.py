from core.matrix import Matrix
from core import det_rank


def test_det_2x2():
    A = Matrix([[4, 7], [2, 6]])
    d, _ = det_rank.determinant(A)
    assert str(d) == "10"


def test_det_singular_is_zero():
    A = Matrix([[1, 2], [2, 4]])
    d, _ = det_rank.determinant(A)
    assert str(d) == "0"


def test_rank():
    assert det_rank.rank(Matrix([[1, 2], [2, 4]])) == 1
    assert det_rank.rank(Matrix([[1, 0], [0, 1]])) == 2


def test_ref():
    M, _ = det_rank.ref_wrap(
        Matrix([[1, 2, 3], [4, 5, 6], [7, 8, 9]]), record_steps=False)
    assert M.to_list() == [["1", "2", "3"], ["0", "-3", "-6"], ["0", "0", "0"]]

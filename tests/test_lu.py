from core.matrix import Matrix
from core import lu, ops


def test_lu_reconstruct_with_pivoting():
    A = Matrix([[2, 1, 1], [4, -6, 0], [-2, 7, 2]])
    P, L, U, swaps, _ = lu.lu_decomposition(A, pivot=True)
    PA = ops.mul(P, A)
    LU = ops.mul(L, U)
    assert PA.to_list() == LU.to_list()


def test_lu_reconstruct_no_pivot_needed():
    # non-singular, no pivoting required in natural order
    A = Matrix([[1, 2, 3], [0, 4, 5], [1, 0, 6]])
    P, L, U, swaps, _ = lu.lu_decomposition(A, pivot=True)
    PA = ops.mul(P, A)
    LU = ops.mul(L, U)
    assert PA.to_list() == LU.to_list()

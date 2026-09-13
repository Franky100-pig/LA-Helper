"""Basic matrix operations: add, subtract, multiply, scalar, transpose, negate."""
from .matrix import Matrix, _to_sympy_scalar


def _assert_shape(A, B):
    if A.shape != B.shape:
        raise ValueError(f"shape mismatch: {A.shape} vs {B.shape}")


def add(A, B):
    _assert_shape(A, B)
    return Matrix([[A.data[r][c] + B.data[r][c] for c in range(A.cols)]
                   for r in range(A.rows)])


def sub(A, B):
    _assert_shape(A, B)
    return Matrix([[A.data[r][c] - B.data[r][c] for c in range(A.cols)]
                   for r in range(A.rows)])


def negate(A):
    return Matrix([[-A.data[r][c] for c in range(A.cols)]
                   for r in range(A.rows)])


def scalar_mul(A, s):
    s = _to_sympy_scalar(s)
    return Matrix([[s * A.data[r][c] for c in range(A.cols)]
                   for r in range(A.rows)])


def transpose(A):
    return A.transpose()


def mul(A, B):
    if A.cols != B.rows:
        raise ValueError(
            f"cannot multiply {A.shape} by {B.shape} "
            f"(inner dimensions {A.cols} != {B.rows})"
        )
    return Matrix(
        [[sum(A.data[r][k] * B.data[k][c] for k in range(A.cols))
          for c in range(B.cols)]
         for r in range(A.rows)]
    )

"""Determinant, rank, and a thin wrapper around RREF."""
from .matrix import Matrix
from .solve import rref
from .lu import lu_decomposition
import sympy as sp


def rank(A):
    _, _, piv = rref(A, record_steps=False)
    return len(piv)


def rref_wrap(A, record_steps=True):
    M, steps, _ = rref(A, record_steps=record_steps)
    return M, steps


def determinant(A, record_steps=True):
    """det(A) via LU: det = det(P)·det(L)·det(U) = (±1)·1·(∏ diag U)."""
    if not A.is_square():
        raise ValueError(f"determinant needs a square matrix, got {A.shape}")
    try:
        P, L, U, swaps, _ = lu_decomposition(A, pivot=True, record_steps=False)
    except ValueError:
        return sp.Integer(0), (["Matrix is singular → det = 0"]
                              if record_steps else [])
    prod = sp.Integer(1)
    for i in range(A.rows):
        prod = prod * U.data[i][i]
    det = prod if swaps % 2 == 0 else -prod
    det = sp.simplify(det)
    steps = []
    if record_steps:
        sign = 1 if swaps % 2 == 0 else -1
        steps.append(
            "det(A) = det(P)·det(L)·det(U) = (%+d)·1·(product of U diagonal)"
            % sign
        )
    return det, steps

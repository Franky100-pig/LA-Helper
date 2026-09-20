"""Determinant, rank, and thin wrappers around the echelon-form routines."""
from .matrix import step
from .solve import rref, ref
from .lu import lu_decomposition
import sympy as sp


def rank(A):
    _, _, piv = rref(A, record_steps=False)
    return len(piv)


def ref_wrap(A, record_steps=True):
    M, steps, _ = ref(A, record_steps=record_steps)
    return M, steps


def determinant(A, record_steps=True):
    """det(A). The value comes from SymPy (correct for singular and symbolic
    matrices); LU decomposition is used to *explain* the value in steps.
    """
    if not A.is_square():
        raise ValueError(f"determinant needs a square matrix, got {A.shape}")

    det = sp.simplify(A.to_sympy().det())
    if not record_steps:
        return det, []

    steps = []
    try:
        P, L, U, swaps, lu_steps = lu_decomposition(
            A, pivot=True, record_steps=True)
        steps.extend(lu_steps)
        steps.append(step("由 P·A = L·U 得 det(A) = det(P)·det(L)·det(U)"))
    except ValueError:
        steps.append(step("消元时出现了零主元 → 矩阵奇异（不可逆）"))
    if det == 0:
        steps.append(step("det(A) = 0，矩阵奇异"))
    else:
        steps.append(step(f"det(A) = {sp.sstr(det)}"))
    return det, steps

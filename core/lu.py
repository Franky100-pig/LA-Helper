"""LU decomposition with optional partial pivoting (PA = LU)."""
from .matrix import Matrix, fmt_expr
import sympy as sp


def lu_decomposition(A, pivot=True, record_steps=True):
    """Factor square A into P·A = L·U (L unit-lower-triangular, U upper-triangular).

    Returns (P, L, U, swap_count, steps).
    """
    if not A.is_square():
        raise ValueError(f"LU needs a square matrix, got {A.shape}")
    n = A.rows
    U = [row[:] for row in A.data]
    L = [[sp.Integer(1 if i == j else 0) for j in range(n)] for i in range(n)]
    perm = list(range(n))
    swaps = 0
    steps = []

    for k in range(n):
        if pivot:
            piv = max(range(k, n), key=lambda i: abs(U[i][k]))
            if piv != k:
                U[k], U[piv] = U[piv], U[k]
                perm[k], perm[piv] = perm[piv], perm[k]
                for j in range(k):
                    L[k][j], L[piv][j] = L[piv][j], L[k][j]
                swaps += 1
                if record_steps:
                    steps.append(
                        f"Swap R{k + 1} ↔ R{piv + 1} (partial pivoting)"
                    )
        if U[k][k].equals(0):
            raise ValueError(
                f"matrix is singular / rank-deficient at pivot {k + 1}"
            )
        for i in range(k + 1, n):
            factor = sp.simplify(U[i][k] / U[k][k])
            L[i][k] = factor
            for j in range(k, n):
                U[i][j] = sp.simplify(U[i][j] - factor * U[k][j])
            if record_steps and not factor.equals(0):
                steps.append(
                    f"R{i + 1} → R{i + 1} − ({fmt_expr(factor)})·R{k + 1}"
                )
    Lm = Matrix([[L[i][j] for j in range(n)] for i in range(n)])
    Um = Matrix([[U[i][j] for j in range(n)] for i in range(n)])
    Pm = _perm_matrix(perm, n)
    return Pm, Lm, Um, swaps, steps


def _perm_matrix(perm, n):
    P = [[sp.Integer(0) for _ in range(n)] for _ in range(n)]
    for i, p in enumerate(perm):
        P[i][p] = sp.Integer(1)
    return Matrix(P)

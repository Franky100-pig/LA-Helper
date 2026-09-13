"""Matrix inverses: square (Gauss-Jordan), left, right, and pseudoinverse."""
from .matrix import Matrix, fmt_expr
from . import ops
from .solve import rref
import sympy as sp


def inverse(A, record_steps=True):
    """Inverse of a square matrix via Gauss-Jordan on [A | I]."""
    if not A.is_square():
        raise ValueError(f"inverse needs a square matrix, got {A.shape}")
    n = A.rows
    aug_data = [[A.data[r][c] for c in range(n)] +
                [sp.Integer(1) if r == c else sp.Integer(0) for c in range(n)]
                for r in range(n)]
    M = Matrix(aug_data)
    steps = []
    for c in range(n):
        pivot = None
        for i in range(c, n):
            if not M.data[i][c].equals(0):
                pivot = i
                break
        if pivot is None:
            raise ValueError("matrix is singular (not invertible)")
        if pivot != c:
            M.data[c], M.data[pivot] = M.data[pivot], M.data[c]
            if record_steps:
                steps.append(f"Swap R{c + 1} ↔ R{pivot + 1}")
        pv = M.data[c][c]
        if not pv.equals(1):
            for k in range(2 * n):
                M.data[c][k] = sp.simplify(M.data[c][k] / pv)
            if record_steps:
                steps.append(f"R{c + 1} → R{c + 1} / ({fmt_expr(pv)})")
        for i in range(n):
            if i != c and not M.data[i][c].equals(0):
                factor = M.data[i][c]
                for k in range(2 * n):
                    M.data[i][k] = sp.simplify(M.data[i][k] - factor * M.data[c][k])
                if record_steps:
                    steps.append(
                        f"R{i + 1} → R{i + 1} − ({fmt_expr(factor)})·R{c + 1}"
                    )
    inv = Matrix([[M.data[r][c + n] for c in range(n)] for r in range(n)])
    return inv, steps


def _rank(A):
    _, _, piv = rref(A, record_steps=False)
    return len(piv)


def left_inverse(A, record_steps=True, rank=None):
    """(AᵀA)⁻¹ Aᵀ, valid when A has full column rank."""
    m, n = A.shape
    if m < n:
        return None, f"A is {m}×{n}: needs m ≥ n for a left inverse"
    r = _rank(A) if rank is None else rank
    if r != n:
        return None, f"A has rank {r} < {n} (not full column rank)"
    AT = A.transpose()
    ATA = ops.mul(AT, A)
    ATA_inv, _ = inverse(ATA, record_steps=False)
    L = ops.mul(ATA_inv, AT)
    steps = ["Compute AᵀA, invert it, then left-inverse = (AᵀA)⁻¹ Aᵀ"]
    return L, (steps if record_steps else [])


def right_inverse(A, record_steps=True, rank=None):
    """Aᵀ (A Aᵀ)⁻¹, valid when A has full row rank."""
    m, n = A.shape
    if m > n:
        return None, f"A is {m}×{n}: needs m ≤ n for a right inverse"
    r = _rank(A) if rank is None else rank
    if r != m:
        return None, f"A has rank {r} < {m} (not full row rank)"
    AT = A.transpose()
    AAT = ops.mul(A, AT)
    AAT_inv, _ = inverse(AAT, record_steps=False)
    R = ops.mul(AT, AAT_inv)
    steps = ["Compute AAᵀ, invert it, then right-inverse = Aᵀ (AAᵀ)⁻¹"]
    return R, (steps if record_steps else [])


def pseudo_inverse(A, record_steps=True):
    """Moore-Penrose pseudoinverse."""
    m, n = A.shape
    r = _rank(A)
    try:
        if r == n and m >= n:
            L, _ = left_inverse(A, record_steps=False, rank=r)
            return L, ["Full column rank → pinv = left inverse (AᵀA)⁻¹Aᵀ"]
        if r == m and n >= m:
            R, _ = right_inverse(A, record_steps=False, rank=r)
            return R, ["Full row rank → pinv = right inverse Aᵀ(AAᵀ)⁻¹"]
    except ValueError:
        pass
    P = A.to_sympy().pinv()
    M = Matrix.from_sympy(P)
    return M, ["General Moore-Penrose pseudoinverse (via SVD)"]

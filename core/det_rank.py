"""Determinant, rank, and thin wrappers around the echelon-form routines."""
from .matrix import fmt_expr, step
from .solve import rref, ref
from .lu import lu_decomposition
from . import i18n
import sympy as sp


def rank(A):
    _, _, piv = rref(A, record_steps=False)
    return len(piv)


def ref_wrap(A, record_steps=True):
    M, steps, _ = ref(A, record_steps=record_steps)
    return M, steps


# 代数余子式展开是 O(n!)，只适合小矩阵；再大就请改用行变换法。
MAX_COFACTOR_DIM = 6


def determinant(A, record_steps=True, method="row_reduction"):
    """det(A), by one of two student-facing methods.

    ``method="row_reduction"`` (default): the *value* comes from SymPy (correct
    for singular and symbolic matrices); LU decomposition is used to *explain*
    it step by step.

    ``method="cofactor"``: expand along the row/column with the most zeros,
    recording every minor so the expansion can be followed by hand.
    """
    if not A.is_square():
        raise ValueError(f"determinant needs a square matrix, got {A.shape}")
    if method == "cofactor":
        return _determinant_cofactor(A, record_steps)
    return _determinant_row_reduction(A, record_steps)


def _determinant_row_reduction(A, record_steps=True):
    """det(A) via P·A = L·U, so the steps are the elimination steps.

    Returns ``(det, steps)``; ``steps`` is empty when ``record_steps`` is off.
    """
    det = sp.simplify(A.to_sympy().det())
    if not record_steps:
        return det, []

    steps = []
    try:
        P, L, U, swaps, lu_steps = lu_decomposition(
            A, pivot=True, record_steps=True)
        steps.extend(lu_steps)
        steps.append(step(i18n.tr("det.lu_factor")))
    except ValueError:
        steps.append(step(i18n.tr("det.zero_pivot")))
    if det == 0:
        steps.append(step(i18n.tr("det.zero")))
    else:
        steps.append(step(i18n.tr("det.value", value=fmt_expr(det))))
    return det, steps


# --- 代数余子式展开 ---------------------------------------------------------

def _minor(data, i, j):
    """Submatrix with row i and column j removed (raw sympy data)."""
    n = len(data)
    return [[data[r][c] for c in range(n) if c != j]
            for r in range(n) if r != i]


def _best_expansion(data):
    """Pick the row or column holding the most zeros.

    Expanding along a row/column full of zeros skips those terms entirely, so
    this both shortens the working and matches what you'd do by hand.
    Returns (index, "row" | "col").
    """
    n = len(data)
    best = (0, "row", -1)
    for r in range(n):
        zeros = sum(1 for c in range(n) if data[r][c].equals(0))
        if zeros > best[2]:
            best = (r, "row", zeros)
    for c in range(n):
        zeros = sum(1 for r in range(n) if data[r][c].equals(0))
        if zeros > best[2]:
            best = (c, "col", zeros)
    return best[0], best[1]


def _cofactor_value(data, steps, depth):
    """Recursively expand ``data`` and record each minor as a step."""
    n = len(data)
    if n == 1:
        return data[0][0]

    idx, kind = _best_expansion(data)
    pad = "· " * depth
    if kind == "row":
        head = i18n.tr("det.cofactor.row_head", pad=pad, index=idx + 1)
        terms = [(idx, j) for j in range(n)]
    else:
        head = i18n.tr("det.cofactor.col_head", pad=pad, index=idx + 1)
        terms = [(i, idx) for i in range(n)]
    steps.append(step(head, data))

    total = sp.Integer(0)
    for i, j in terms:
        a = data[i][j]
        if a.equals(0):
            continue                       # 该余子式系数为 0，整项跳过
        sgn = 1 if (i + j) % 2 == 0 else -1
        minor = _minor(data, i, j)
        steps.append(step(
            i18n.tr("det.cofactor.term", pad=pad, row=i + 1, col=j + 1,
                    coef=fmt_expr(sgn * a)),
            minor))
        total += sgn * a * _cofactor_value(minor, steps, depth + 1)

    total = sp.simplify(total)
    if depth > 0:
        steps.append(step(i18n.tr("det.cofactor.level_total",
                                  pad=pad, total=fmt_expr(total))))
    return total


def _determinant_cofactor(A, record_steps=True):
    """det(A) by cofactor expansion along the sparsest row/column.

    O(n!), hence MAX_COFACTOR_DIM. The steps read as a tree: each level expands
    one minor, and a level closes with its own subtotal.
    """
    n = A.rows
    if n > MAX_COFACTOR_DIM:
        raise ValueError(i18n.tr("err.det.cofactor_too_big",
                                 limit=MAX_COFACTOR_DIM, rows=n, cols=n))

    if not record_steps:
        return sp.simplify(A.to_sympy().det()), []

    steps = []
    if n == 1:
        v = sp.simplify(A.data[0][0])
        steps.append(step(i18n.tr("det.cofactor.one_by_one", value=fmt_expr(v))))
        return v, steps

    det = sp.simplify(_cofactor_value([row[:] for row in A.data], steps, 0))
    steps.append(step(i18n.tr("det.value", value=fmt_expr(det))))
    return det, steps


# --- 余子式矩阵 / 伴随矩阵 ---------------------------------------------------

def cofactor_matrix(A, record_steps=False):
    """余子式矩阵 C 与伴随矩阵 adj(A)=Cᵀ。

    C(i,j) = (−1)^(i+j) · det(划掉第 i 行第 j 列的余子式 M(i,j))。
    伴随矩阵 adj(A) = Cᵀ，配合 det(A) 可写出 A⁻¹ = adj(A)/det(A)（det≠0 时）。

    n 稍大时 O(n·n!) 会爆炸（要算 n² 个 n−1 阶行列式），沿用行列式代数余子式
    展开的上限 MAX_COFACTOR_DIM；超过就在引擎层提示改用「方阵求逆 A⁻¹」。
    """
    n = A.rows
    if not A.is_square():
        raise ValueError(i18n.tr("err.det.cofactor_matrix_needs_square",
                                 shape=A.shape))
    if n > MAX_COFACTOR_DIM:
        raise ValueError(i18n.tr("err.det.cofactor_matrix_too_big",
                                 limit=MAX_COFACTOR_DIM, rows=n, cols=n))
    data = A.data
    C = [[None] * n for _ in range(n)]
    adj = [[None] * n for _ in range(n)]
    steps = []
    for i in range(n):
        for j in range(n):
            minor = _minor(data, i, j)
            Mn = sp.simplify(sp.Matrix(minor).det())
            sgn = 1 if (i + j) % 2 == 0 else -1
            c = sgn * Mn
            C[i][j] = c
            adj[j][i] = c  # adj(A) = Cᵀ
            if record_steps and n <= 5:
                steps.append(step(
                    i18n.tr("det.cofactor_matrix.entry",
                            row=i + 1, col=j + 1, sign=fmt_expr(sgn),
                            minor=fmt_expr(Mn), value=fmt_expr(c)),
                    minor))
    det = sp.simplify(A.to_sympy().det())
    if record_steps:
        steps.append(step(i18n.tr("det.cofactor_matrix.done")))
    return C, adj, det, steps

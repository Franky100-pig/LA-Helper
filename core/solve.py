"""RREF, augmented-matrix solving, and null space (all with step recording)."""
from .matrix import Matrix, fmt_expr, step
import sympy as sp


def rref(A, record_steps=True):
    """Reduced row echelon form. Returns (RREF, steps, pivot_columns)."""
    M = A.copy()
    steps = []
    pivot_cols = []
    r = 0
    for c in range(M.cols):
        if r >= M.rows:
            break
        pivot = None
        for i in range(r, M.rows):
            if not M.data[i][c].equals(0):
                pivot = i
                break
        if pivot is None:
            continue  # zero column, skip
        if pivot != r:
            M.data[r], M.data[pivot] = M.data[pivot], M.data[r]
            if record_steps:
                steps.append(step(f"Swap R{r + 1} ↔ R{pivot + 1}", M))
        pv = M.data[r][c]
        if not pv.equals(1):
            for k in range(M.cols):
                M.data[r][k] = sp.simplify(M.data[r][k] / pv)
            if record_steps:
                steps.append(step(f"R{r + 1} → R{r + 1} / ({fmt_expr(pv)})", M))
        for i in range(M.rows):
            if i != r and not M.data[i][c].equals(0):
                factor = M.data[i][c]
                for k in range(M.cols):
                    M.data[i][k] = sp.simplify(M.data[i][k] - factor * M.data[r][k])
                if record_steps:
                    steps.append(step(
                        f"R{i + 1} → R{i + 1} − ({fmt_expr(factor)})·R{r + 1}", M))
        pivot_cols.append(c)
        r += 1
    return M, steps, pivot_cols


def ref(A, record_steps=True):
    """Row echelon form (NOT reduced). Returns (REF, steps, pivot_columns).

    Unlike :func:`rref`, pivots are left at their natural (non-zero) values and
    only entries *below* each pivot are cleared. The result is an upper-
    triangular-like staircase instead of always collapsing to the identity for
    invertible matrices, which makes the elimination visible and instructive.
    """
    M = A.copy()
    steps = []
    pivot_cols = []
    r = 0
    for c in range(M.cols):
        if r >= M.rows:
            break
        pivot = None
        for i in range(r, M.rows):
            if not M.data[i][c].equals(0):
                pivot = i
                break
        if pivot is None:
            continue  # zero column, skip
        if pivot != r:
            M.data[r], M.data[pivot] = M.data[pivot], M.data[r]
            if record_steps:
                steps.append(step(f"Swap R{r + 1} ↔ R{pivot + 1}", M))
        pv = M.data[r][c]
        for i in range(r + 1, M.rows):
            if not M.data[i][c].equals(0):
                factor = sp.simplify(M.data[i][c] / pv)
                for k in range(M.cols):
                    M.data[i][k] = sp.simplify(M.data[i][k] - factor * M.data[r][k])
                if record_steps:
                    steps.append(step(
                        f"R{i + 1} → R{i + 1} − ({fmt_expr(factor)})·R{r + 1}", M))
        pivot_cols.append(c)
        r += 1
    return M, steps, pivot_cols


def null_space(A):
    """Basis of the null space (solutions to A x = 0)."""
    M, _, pivot_cols = rref(A, record_steps=False)
    n = A.cols
    free = [c for c in range(n) if c not in pivot_cols]
    basis = []
    for f in free:
        vec = [sp.Integer(0)] * n
        vec[f] = sp.Integer(1)
        for row in range(len(pivot_cols)):
            p = pivot_cols[row]
            vec[p] = sp.simplify(-M.data[row][f])
        basis.append(Matrix([[v] for v in vec]))
    return basis


def solve_augmented(A, b, record_steps=True):
    """Solve A x = b. b is an m x p matrix (p right-hand-side columns).

    Returns a dict with status, particular solution, null-space basis, free
    variables and steps.
    """
    if A.rows != b.rows:
        raise ValueError(f"A has {A.rows} rows but b has {b.rows}")
    m, n = A.shape
    p = b.cols
    aug_data = [[A.data[r][c] for c in range(n)] +
                [b.data[r][k] for k in range(p)]
                for r in range(m)]
    aug = Matrix(aug_data)
    R, steps, pivot_cols = rref(aug, record_steps=record_steps)
    inconsistent = False
    for row in range(R.rows):
        left_zero = all(R.data[row][c].equals(0) for c in range(n))
        right_nonzero = any(not R.data[row][n + k].equals(0) for k in range(p))
        if left_zero and right_nonzero:
            inconsistent = True
            break
    if inconsistent:
        return {
            "status": "none",
            "particular": None,
            "null_basis": [],
            "free_vars": [],
            "steps": steps,
        }
    particular = [[sp.Integer(0)] * p for _ in range(n)]
    for row in range(len(pivot_cols)):
        pc = pivot_cols[row]
        if pc < n:
            for k in range(p):
                particular[pc][k] = R.data[row][n + k]
    particular_M = Matrix([[particular[r][k] for k in range(p)]
                           for r in range(n)])
    basis = null_space(A)
    status = "unique" if len(pivot_cols) == n else "infinite"
    return {
        "status": status,
        "particular": particular_M,
        "null_basis": basis,
        "free_vars": [c for c in range(n) if c not in pivot_cols],
        "steps": steps,
    }

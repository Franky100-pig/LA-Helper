"""Eigenvalues and eigenvectors.

Exact results are nice until SymPy hands a student ``CRootOf(x**8 - ...))``
after 20 seconds. So: small matrices stay exact, larger ones ("or anything
that can't be written in radicals") fall back to a numeric answer that is
actually readable.
"""
from .matrix import Matrix, fmt_expr
import sympy as sp

# >= this size, default to the numeric path (exact is unusably slow/unreadable)
EIGEN_NUMERIC_MIN = 5
PRECISION = 6


def _is_readable(v):
    """True if v can be shown to a student without scaring them."""
    return not (v.has(sp.CRootOf) or v.has(sp.RootOf) or v.has(sp.Lambda))


def _fmt_num(v, precision):
    """Short numeric string; handles complex values (sp.Float would not)."""
    try:
        return str(sp.Float(sp.N(v, precision), precision))
    except (TypeError, ValueError):
        return str(sp.N(v, precision))


def eigen(A, numeric=None, precision=PRECISION):
    """Return list of {value, exact, approx, multiplicity, geometric, defective,
    vectors} for the eigenvalues of A.
    """
    if not A.is_square():
        raise ValueError(f"eigen needs a square matrix, got {A.shape}")
    n = A.rows
    if numeric is None:
        numeric = n >= EIGEN_NUMERIC_MIN

    M = A.to_sympy()
    if numeric:
        M = M.evalf(15)
    vecs = M.eigenvects()  # (eigenvalue, algebraic_multiplicity, [vectors])

    pairs = []
    for val, mult, basis in vecs:
        v = sp.simplify(val)
        exact = fmt_expr(v)
        readable = _is_readable(v)
        approx = None
        if numeric or not readable:
            approx = _fmt_num(v, precision)
        shown = approx if approx is not None else exact
        vectors = []
        for b in basis:
            if numeric:
                b = b.evalf(precision)
            vectors.append(Matrix.from_sympy(b))
        pairs.append({
            "value": shown,
            "exact": exact,
            "approx": approx,
            "multiplicity": mult,
            "geometric": len(basis),
            "defective": len(basis) < mult,
            "numeric": bool(numeric or not readable),
            "vectors": vectors,
        })
    return pairs

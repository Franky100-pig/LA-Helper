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

# An exact form longer than this reads like machine output, not math (e.g. the
# Cardano formula SymPy gives for a cubic with three real roots runs 100+
# chars of nested cube roots). Those fall back to the decimal value.
READABLE_MAX_LEN = 60

# Imaginary parts below this (relative) are float round-off, not physics.
NOISE = 1e-10


def _clean_noise(v):
    """Drop a negligible imaginary part that is pure numerical round-off."""
    try:
        re_, im_ = sp.re(v), sp.im(v)
        if im_.is_number and abs(im_) < NOISE * max(1, abs(re_)):
            return re_
    except Exception:
        pass
    return v


def _is_readable(v):
    """True if v can be shown to a student without scaring them."""
    if v.has(sp.CRootOf) or v.has(sp.RootOf) or v.has(sp.Lambda):
        return False
    return len(str(v)) <= READABLE_MAX_LEN


def _fmt_num(v, precision):
    """Short numeric string; handles complex values (sp.Float would not)."""
    v = _clean_noise(v)
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
        # Always compute a decimal approximation for display, so even an exact
        # form like (-1 + sqrt(5))/2 is shown next to a friendly 1.618034.
        approx = _fmt_num(v, precision)
        shown = approx if (numeric or not readable) else exact
        vectors = []
        for b in basis:
            if numeric or not readable:
                # Decimal eigenvectors too -- an exact vector for a Cardano
                # eigenvalue is even worse than the eigenvalue itself.
                b = b.evalf(precision).applyfunc(_clean_noise)
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

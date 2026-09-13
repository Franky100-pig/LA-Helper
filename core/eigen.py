"""Eigenvalues and eigenvectors (exact via SymPy)."""
from .matrix import Matrix, fmt_expr


def eigen(A):
    """Return list of {value, multiplicity, vectors} for exact eigenvalues."""
    if not A.is_square():
        raise ValueError(f"eigen needs a square matrix, got {A.shape}")
    M = A.to_sympy()
    vecs = M.eigenvects()  # (eigenvalue, algebraic_multiplicity, [vectors])
    pairs = []
    for val, mult, basis in vecs:
        vectors = [Matrix.from_sympy(v) for v in basis]
        pairs.append({
            "value": fmt_expr(val),
            "multiplicity": mult,
            "vectors": vectors,
        })
    return pairs

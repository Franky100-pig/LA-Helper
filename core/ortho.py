"""Gram-Schmidt and thin QR decomposition with readable learning steps.

Both functions take the project's :class:`core.matrix.Matrix` and return
JSON-friendly, SymPy-derived matrices through ``Matrix.from_sympy``. Steps use
the shared ``step(text, matrix, op="note")`` shape so the web step player and
the desktop step view can consume them unchanged.

Only full column rank is supported. If a column collapses to zero after the
projections are removed, that is a *finding*, not a crash: the caller receives
a clear bilingual error saying the columns are dependent.
"""
import sympy as sp

from . import i18n
from .matrix import Matrix, fmt_expr, snapshot, step


def _vec_str(v):
    return "(" + ", ".join(fmt_expr(sp.simplify(x)) for x in v) + ")"


def gram_schmidt(A, record_steps=True):
    """Return orthogonal columns B, orthonormal columns Q and the coefficients.

    ``coeffs[k][j]`` is q_j · a_k for j < k — i.e. the amount of a_k that is
    removed along q_j. The same numbers become the strictly upper part of R
    in :func:`qr`.
    """
    M = A.to_sympy()
    m, n = M.shape
    if n > m:
        raise ValueError(i18n.tr("err.ortho.too_many_columns", m=m, n=n))

    columns = [M[:, k] for k in range(n)]
    B, Q, coeffs, norms = [], [], [], []
    steps = []

    for k, a in enumerate(columns):
        b = sp.Matrix(a)
        cs = []
        if record_steps:
            if k == 0:
                steps.append(step(i18n.tr("ortho.step.first", v=_vec_str(b)),
                                  op="note"))
            else:
                steps.append(step(i18n.tr("ortho.step.next", k=k + 1,
                                          v=_vec_str(b)), op="note"))
        for j, q in enumerate(Q):
            c = sp.simplify((q.T * b)[0])
            cs.append(c)
            if c == 0:
                continue
            b = sp.simplify(b - c * q)
            if record_steps:
                steps.append(step(i18n.tr(
                    "ortho.step.project", k=k + 1, j=j + 1,
                    c=fmt_expr(c), v=_vec_str(b)), op="note"))

        norm = sp.sqrt(sp.simplify((b.T * b)[0]))
        if sp.simplify(norm) == 0:
            raise ValueError(i18n.tr("err.ortho.dependent", k=k + 1))

        q = sp.simplify(b / norm)
        B.append(b)
        Q.append(q)
        coeffs.append(cs)
        norms.append(norm)
        if record_steps:
            steps.append(step(i18n.tr(
                "ortho.step.normalize", k=k + 1,
                n=fmt_expr(norm), v=_vec_str(q)), op="note"))

    return {
        "B": Matrix.from_sympy(sp.Matrix.hstack(*B)),
        "Q": Matrix.from_sympy(sp.Matrix.hstack(*Q)),
        "coeffs": coeffs,
        "norms": norms,
        "steps": steps,
    }


def qr(A, record_steps=True):
    """Thin QR: A = Q R with orthonormal Q and upper-triangular R."""
    gs = gram_schmidt(A, record_steps=record_steps)
    n = len(gs["norms"])
    R = sp.zeros(n, n)
    for j in range(n):
        for i in range(j):
            R[i, j] = gs["coeffs"][j][i]
        R[j, j] = gs["norms"][j]

    steps = gs["steps"]
    if record_steps:
        steps.append(step(i18n.tr("ortho.step.qr_built"),
                          snapshot(R.tolist()), op="note"))

    return {
        "Q": gs["Q"],
        "R": Matrix.from_sympy(R),
        "steps": steps,
    }

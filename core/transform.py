"""Apply a linear transformation T(x) = A·x, one dot product per output row.

The engine already has ``multiply`` (A·B), which would compute the same vector
when B is a column. This module exists for the *explanation*: students meet
T(x) as a function first and a matrix product second, so each output component
is written out as "row i · x" with the numbers substituted.
"""
from .matrix import fmt_expr, step
from . import i18n
from . import ops


def _product(a, v):
    """One a·v term; a negative product gets parentheses inside the sum."""
    s = f"{fmt_expr(a)}·{fmt_expr(v)}"
    return f"({s})" if s.startswith("-") else s


def apply(A, x, record_steps=True):
    """Return ``(A·x, steps)``. ``x`` must already be a column vector."""
    y = ops.mul(A, x)
    steps = []
    if record_steps:
        steps.append(step(i18n.tr("transform.intro"), op="note"))
        for i in range(A.rows):
            terms = " + ".join(_product(A.data[i][j], x.data[j][0])
                               for j in range(A.cols))
            steps.append(step(
                i18n.tr("transform.component", i=i + 1, expr=terms,
                        value=fmt_expr(y.data[i][0])),
                op="note",
            ))
        steps.append(step(i18n.tr("transform.done"), y, op="note"))
    return y, steps

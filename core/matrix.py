"""Core matrix data structure for LA Helper.

Uses exact rational arithmetic via SymPy so that, e.g., 1/3 never becomes
0.333. Matrices are stored as a list of lists of simplified SymPy expressions.
"""
import sympy as sp


def _to_sympy_scalar(x):
    """Convert int / float / str / Fraction / SymPy into a simplified SymPy expr."""
    if isinstance(x, sp.Basic):
        return sp.simplify(x)
    if isinstance(x, bool):
        return sp.Integer(int(x))
    if isinstance(x, int):
        return sp.Integer(x)
    if isinstance(x, float):
        from fractions import Fraction
        return sp.Rational(Fraction(x).limit_denominator(10 ** 9))
    if isinstance(x, str):
        return sp.sympify(x)
    try:
        return sp.Rational(x)
    except Exception:
        return sp.sympify(x)


def fmt_expr(x):
    """Exact, human-readable string for a cell value."""
    return str(sp.simplify(x))


class Matrix:
    def __init__(self, data):
        if data is None or (hasattr(data, "__len__") and len(data) == 0):
            self.rows = 0
            self.cols = 0
            self.data = []
            return
        self.rows = len(data)
        self.cols = len(data[0])
        for i, row in enumerate(data):
            if len(row) != self.cols:
                raise ValueError(
                    f"row {i} has length {len(row)}, expected {self.cols}"
                )
        self.data = [[_to_sympy_scalar(v) for v in row] for row in data]

    @property
    def shape(self):
        return (self.rows, self.cols)

    def is_square(self):
        return self.rows == self.cols

    def copy(self):
        return Matrix([[self.data[r][c] for c in range(self.cols)]
                       for r in range(self.rows)])

    def transpose(self):
        return Matrix([[self.data[r][c] for r in range(self.rows)]
                       for c in range(self.cols)])

    def to_sympy(self):
        return sp.Matrix([[self.data[r][c] for c in range(self.cols)]
                          for r in range(self.rows)])

    @classmethod
    def from_sympy(cls, M):
        return cls([[M[r, c] for c in range(M.cols)] for r in range(M.rows)])

    def to_list(self):
        """Nested lists of exact string representations (JSON-friendly)."""
        return [[fmt_expr(self.data[r][c]) for c in range(self.cols)]
                for r in range(self.rows)]

    def __eq__(self, other):
        if not isinstance(other, Matrix):
            return NotImplemented
        if self.shape != other.shape:
            return False
        return all(self.data[r][c] == other.data[r][c]
                   for r in range(self.rows) for c in range(self.cols))

    def __repr__(self):
        return "Matrix(" + repr(self.to_list()) + ")"

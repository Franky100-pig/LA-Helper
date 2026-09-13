"""Core matrix data structure for LA Helper.

Uses exact rational arithmetic via SymPy so that, e.g., 1/3 never becomes
0.333. Matrices are stored as a list of lists of simplified SymPy expressions.

Input parsing is deliberately *restricted* instead of a full ``sympify``:
a learning calculator should reject a typo like "abc", and must never be able
to evaluate something like "9**9**9" (a denial-of-service vector).
"""
import re

import sympy as sp

MAX_CELL_LEN = 64

# 1, -1, 1.5, .5, 1e-3, 1/3, -2/7 ...  (no operators, no function calls)
_NUMBER_RE = re.compile(
    r"""^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"""
    r"""(?:\s*/\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)?$"""
)
# a single bare symbol name: x, lambda1, _t
_SYMBOL_RE = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*$")


def _to_sympy_scalar(x, allow_symbols=False):
    """Convert int / float / str / Fraction / SymPy into a simplified SymPy expr.

    Strings are parsed with a whitelist. Raises ValueError with a
    user-readable message instead of silently producing a symbol.
    """
    if isinstance(x, sp.Basic):
        return sp.simplify(x)
    if isinstance(x, bool):
        return sp.Integer(int(x))
    if isinstance(x, int):
        return sp.Integer(x)
    if isinstance(x, float):
        return _float_to_rational(x)
    if isinstance(x, str):
        return _parse_cell(x, allow_symbols=allow_symbols)
    try:
        return sp.Rational(x)
    except Exception:
        return sp.sympify(x)


def _float_to_rational(x):
    """Exact decimal value of a float: 0.1 -> 1/10 (not 3602879701896397/2**55)."""
    try:
        return sp.Rational(str(x))
    except Exception:
        return sp.Rational(x).limit_denominator(10 ** 9)


def _parse_cell(s, allow_symbols=False):
    """Parse one grid cell. Whitelist only: numbers, and optionally symbols."""
    s = s.strip()
    if not s:
        raise ValueError("单元格为空，请填 0 或删除该行/列")
    if len(s) > MAX_CELL_LEN:
        raise ValueError(f"单元格内容过长（>{MAX_CELL_LEN} 字符）：{s[:20]}…")
    if _NUMBER_RE.match(s):
        try:
            return sp.Rational(s)
        except Exception:
            return sp.Rational(sp.Float(s))
    if allow_symbols and _SYMBOL_RE.match(s):
        return sp.Symbol(s)
    raise ValueError(
        f"无法识别的输入 {s!r}；仅支持整数、小数、分数（如 1/3）"
        + ("或单个字母变量" if allow_symbols else "")
    )


def fmt_expr(x):
    """Exact, human-readable string for a cell value."""
    return str(sp.simplify(x))


class Matrix:
    def __init__(self, data, allow_symbols=False):
        if data is None or (hasattr(data, "__len__") and len(data) == 0):
            self.rows = 0
            self.cols = 0
            self.data = []
            return
        if not isinstance(data, (list, tuple)):
            raise ValueError(f"矩阵需要是「行」的列表，收到 {type(data).__name__}")
        self.rows = len(data)
        for i, row in enumerate(data):
            if not isinstance(row, (list, tuple)):
                raise ValueError(f"第 {i + 1} 行需要是「元素」的列表，收到 {type(row).__name__}")
        self.cols = len(data[0])
        for i, row in enumerate(data):
            if len(row) != self.cols:
                raise ValueError(
                    f"row {i} has length {len(row)}, expected {self.cols}"
                )
        self.data = [[_to_sympy_scalar(v, allow_symbols=allow_symbols) for v in row]
                     for row in data]

    @property
    def shape(self):
        return (self.rows, self.cols)

    def is_empty(self):
        return self.rows == 0 or self.cols == 0

    def is_square(self):
        return self.rows == self.cols and self.rows > 0

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

    # Mutable + structural equality -> explicitly unhashable.
    __hash__ = None

    def __repr__(self):
        return "Matrix(" + repr(self.to_list()) + ")"

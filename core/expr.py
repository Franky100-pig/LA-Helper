"""Expression shortcut over named matrices.

``A + B``, ``inv(A) * B``, ``det(A)``, ``A^2`` — a fast path for the operation
dropdown, not a replacement for it: every root operation is dispatched back
through :func:`core.engine.compute`, so an expression and its dropdown
equivalent produce byte-identical results, *including the step trace*.

User text is never handed to ``eval()`` / ``sympify()``. It is tokenized by a
whitelist and walked by a hand-written recursive-descent parser, so ``9**9**9``
stays a syntax error instead of becoming a denial-of-service.
"""
import re

from .matrix import Matrix, fmt_expr, _parse_cell
from .engine import compute, MAX_DIM
from . import ops
from . import inverse as inv_mod
from . import det_rank


class ExprError(ValueError):
    """A problem the user can fix: bad character, unknown name, wrong arity."""


# Guards. All three exist to keep a typo from turning into a hang.
MAX_EXPR_LEN = 500
_MAX_DEPTH = 32
_MAX_POWER = 64

# Function table: name -> (min_args, max_args, compute op, standalone only?)
# "standalone only" = the result is not a single matrix/scalar, so it cannot be
# composed into a larger expression (lu gives three matrices, solve a solution
# set, eigen a list of pairs).
_FUNCS = {
    "inv":       (1, 1, "inverse", False),
    "det":       (1, 1, "det", False),
    "rank":      (1, 1, "rank", False),
    "ref":       (1, 1, "ref", False),
    "transpose": (1, 1, "transpose", False),
    "T":         (1, 1, "transpose", False),
    "pinv":      (1, 1, "pseudo_inverse", False),
    "lu":        (1, 1, "lu", True),
    "solve":     (2, 2, "solve", True),
    "eigen":     (1, 1, "eigen", True),
}

_WS_RE = re.compile(r"\s+")
# No slash here: in an expression "/" is division, and 1/3 is written 1 / 3.
_NUM_RE = re.compile(r"(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?")
_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_OPS = "+-*/^(),"


# --- AST ---------------------------------------------------------------------

class Num:
    __slots__ = ("text",)

    def __init__(self, text):
        self.text = text


class Name:
    __slots__ = ("name",)

    def __init__(self, name):
        self.name = name


class Unary:
    __slots__ = ("op", "operand")

    def __init__(self, op, operand):
        self.op = op
        self.operand = operand


class Binary:
    __slots__ = ("op", "left", "right")

    def __init__(self, op, left, right):
        self.op = op
        self.left = left
        self.right = right


class Call:
    __slots__ = ("name", "args")

    def __init__(self, name, args):
        self.name = name
        self.args = args


# --- tokenizer ---------------------------------------------------------------

def tokenize(text):
    """Whitelist scan. Returns [(kind, text, pos), ...] ending with "end"."""
    if len(text) > MAX_EXPR_LEN:
        raise ExprError(f"表达式过长（超过 {MAX_EXPR_LEN} 字符）")
    tokens = []
    i, n = 0, len(text)
    while i < n:
        m = _WS_RE.match(text, i)
        if m:
            i = m.end()
            continue
        m = _NUM_RE.match(text, i)
        if m:
            tokens.append(("number", m.group(0), i))
            i = m.end()
            continue
        m = _NAME_RE.match(text, i)
        if m:
            name = m.group(0)
            if name.startswith("_"):
                raise ExprError(f"位置 {i + 1}：不认识的名称 {name!r}")
            tokens.append(("name", name, i))
            i = m.end()
            continue
        if text.startswith("**", i):
            raise ExprError(
                f"位置 {i + 1}：幂运算请用单个 ^（例如 A^2），不支持 **"
            )
        ch = text[i]
        if ch in _OPS:
            tokens.append(("op", ch, i))
            i += 1
            continue
        raise ExprError(f"位置 {i + 1}：无法识别的字符 {ch!r}")
    tokens.append(("end", "", n))
    return tokens


# --- parser ------------------------------------------------------------------

class _Parser:
    """Recursive descent over the token list.

    Precedence, lowest first:  + -   /   * /   ^ (right assoc)   unary   atom
    """

    def __init__(self, tokens):
        self.toks = tokens
        self.i = 0

    # -- token helpers
    def _peek(self):
        return self.toks[self.i]

    def _at_op(self, *ops_):
        k, t, _ = self._peek()
        return k == "op" and t in ops_

    def _take(self):
        tok = self.toks[self.i]
        self.i += 1
        return tok

    def _expect_op(self, op):
        k, t, pos = self._peek()
        if k != "op" or t != op:
            got = t if k != "end" else "表达式末尾"
            raise ExprError(f"位置 {pos + 1}：应为 {op!r}，实际是 {got}")
        return self._take()

    # -- grammar
    def parse(self, depth=0):
        node = self.expr(depth)
        k, t, pos = self._peek()
        if k != "end":
            raise ExprError(f"位置 {pos + 1}：多余的 {t!r}")
        return node

    def expr(self, depth):
        node = self.term(depth)
        while self._at_op("+", "-"):
            op = self._take()[1]
            node = Binary(op, node, self.term(depth))
        return node

    def term(self, depth):
        node = self.unary(depth)
        while self._at_op("*", "/"):
            op = self._take()[1]
            node = Binary(op, node, self.unary(depth))
        return node

    def unary(self, depth):
        if self._at_op("+", "-"):
            op = self._take()[1]
            return Unary(op, self.unary(depth))
        return self.power(depth)

    def power(self, depth):
        base = self.atom(depth)
        if self._at_op("^"):
            self._take()
            # Right associative, and the exponent goes through unary so that
            # A^-1 parses as A raised to -1.
            return Binary("^", base, self.unary(depth))
        return base

    def atom(self, depth):
        if depth > _MAX_DEPTH:
            raise ExprError(f"表达式嵌套过深（超过 {_MAX_DEPTH} 层）")
        k, t, pos = self._peek()
        if k == "op" and t == "(":
            self._take()
            node = self.expr(depth + 1)
            self._expect_op(")")
            return node
        if k == "op" and t == "-":
            # Reached via power() where unary() was bypassed; keep it working.
            self._take()
            return Unary("-", self.atom(depth))
        if k == "number":
            self._take()
            return Num(t)
        if k == "name":
            self._take()
            if self._at_op("("):
                self._take()
                args = []
                if not self._at_op(")"):
                    args.append(self.expr(depth + 1))
                    while self._at_op(","):
                        self._take()
                        args.append(self.expr(depth + 1))
                self._expect_op(")")
                return Call(t, args)
            return Name(t)
        if k == "end":
            raise ExprError("表达式不完整：末尾还缺一个操作数")
        raise ExprError(f"位置 {pos + 1}：意外的 {t!r}")


def parse(text):
    """Parse an expression string into an AST. Raises ExprError."""
    return _Parser(tokenize(text)).parse()


# --- evaluation --------------------------------------------------------------

def _func_spec(name):
    return _FUNCS.get(name) or _FUNCS.get(name.lower())


def _check_arity(name, spec, argc):
    low, high = spec[0], spec[1]
    if not (low <= argc <= high):
        want = str(low) if low == high else f"{low}-{high}"
        raise ExprError(f"函数 {name} 需要 {want} 个参数，收到 {argc} 个")


def _lookup(name, lib):
    if name not in lib:
        have = "、".join(sorted(lib)) if lib else "空"
        raise ExprError(f"未知矩阵 {name}（当前矩阵库：{have}）")
    M = Matrix(lib[name])
    if M.rows > MAX_DIM or M.cols > MAX_DIM:
        raise ExprError(
            f"矩阵 {name} 是 {M.rows}×{M.cols}，超过上限 {MAX_DIM}×{MAX_DIM}"
        )
    return M


def _one(scalar):
    """Wrap a scalar as 1x1 matrix data, for the engine's 'scalar' op."""
    return [[fmt_expr(scalar)]]


def _mat_power(M, n):
    if n == 0:
        return Matrix.from_sympy(M.to_sympy() ** 0)
    if n < 0:
        M = inv_mod.inverse(M, record_steps=False)[0]
        n = -n
    R = M
    for _ in range(n - 1):
        R = ops.mul(R, M)
    return R


def _eval(node, lib):
    """Evaluate to a Matrix or a SymPy scalar (no step recording)."""
    if isinstance(node, Num):
        # _parse_cell enforces the same whitelist (and exponent guard) as a grid
        # cell; surface its message as an ExprError so the UI sees a clean line
        # instead of a "ValueError: ..." prefix.
        try:
            return _parse_cell(node.text)
        except ValueError as e:
            raise ExprError(str(e))
    if isinstance(node, Name):
        return _lookup(node.name, lib)
    if isinstance(node, Unary):
        v = _eval(node.operand, lib)
        if node.op == "+":
            return v
        return ops.negate(v) if isinstance(v, Matrix) else -v
    if isinstance(node, Call):
        spec = _func_spec(node.name)
        if spec is None:
            raise ExprError(f"未知函数 {node.name}")
        _check_arity(node.name, spec, len(node.args))
        if spec[3]:
            raise ExprError(
                f"函数 {node.name} 的结果是多项，只能单独使用，不能参与计算"
            )
        M = _as_matrix(_eval(node.args[0], lib), node.name)
        if node.name.lower() in ("inv",) or node.name == "inv":
            return inv_mod.inverse(M, record_steps=False)[0]
        if node.name.lower() == "pinv":
            return inv_mod.pseudo_inverse(M, record_steps=False)[0]
        if node.name.lower() == "det":
            return det_rank.determinant(M, record_steps=False)[0]
        if node.name.lower() == "rank":
            return det_rank.rank(M)
        if node.name.lower() == "ref":
            return det_rank.ref_wrap(M, record_steps=False)[0]
        return ops.transpose(M)                       # transpose / T

    # Binary
    L = _eval(node.left, lib)
    R = _eval(node.right, lib)
    Lm, Rm = isinstance(L, Matrix), isinstance(R, Matrix)
    op = node.op

    if op == "+":
        if Lm and Rm:
            return ops.add(L, R)
        if not Lm and not Rm:
            return L + R
        raise ExprError("不能把矩阵和标量相加")
    if op == "-":
        if Lm and Rm:
            return ops.sub(L, R)
        if not Lm and not Rm:
            return L - R
        raise ExprError("不能把矩阵和标量相减")
    if op == "*":
        if Lm and Rm:
            return ops.mul(L, R)
        if Lm:
            return ops.scalar_mul(L, R)
        if Rm:
            return ops.scalar_mul(R, L)
        return L * R
    if op == "/":
        if Rm:
            raise ExprError("不支持矩阵除法；若要算 A 乘 B 的逆，请写 A * inv(B)")
        if Lm:
            return ops.scalar_mul(L, 1 / R)
        return L / R
    if op == "^":
        if isinstance(R, Matrix):
            raise ExprError("幂指数不能是矩阵；请写整数，如 A^2、A^-1")
        if not isinstance(R, int) and not R.is_Integer:
            raise ExprError("幂指数必须是整数（如 A^2、A^-1）")
        n = int(R)
        if abs(n) > _MAX_POWER:
            raise ExprError(f"幂指数过大（上限 {_MAX_POWER}）")
        if Lm:
            return _mat_power(L, n)
        return L ** n
    raise ExprError(f"不支持的运算符 {op!r}")


def _as_matrix(v, where):
    if not isinstance(v, Matrix):
        raise ExprError(f"{where} 需要矩阵参数，实际收到标量")
    return v


def _wrap(v):
    if isinstance(v, Matrix):
        return {"ok": True, "type": "matrix", "data": v.to_list(), "steps": []}
    return {"ok": True, "type": "scalar", "value": fmt_expr(v), "steps": []}


def evaluate(text, matrices, show_steps=True):
    """Evaluate an expression against a named-matrix library.

    ``matrices`` maps a name to matrix data (nested lists of cell strings).
    Returns the same envelope as :func:`core.engine.compute`.
    """
    try:
        node = parse(text)
        return _render(node, matrices or {}, show_steps)
    except ExprError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:                                    # noqa: BLE001
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}


def _render(node, lib, show_steps):
    """Produce the result envelope, reusing engine.compute at the root."""
    # A whole-expression function call goes straight back through compute() so
    # the dropdown and the expression share one code path, steps included.
    if isinstance(node, Call):
        spec = _func_spec(node.name)
        if spec is not None and spec[2] is not None:
            _check_arity(node.name, spec, len(node.args))
            args = [_as_matrix(_eval(a, lib), node.name) for a in node.args]
            return compute(spec[2], args[0].to_list(),
                           args[1].to_list() if len(args) > 1 else None,
                           show_steps=show_steps)

    if isinstance(node, Binary):
        L = _eval(node.left, lib)
        R = _eval(node.right, lib)
        Lm, Rm = isinstance(L, Matrix), isinstance(R, Matrix)
        if node.op == "+" and Lm and Rm:
            return compute("add", L.to_list(), R.to_list(), show_steps=show_steps)
        if node.op == "-" and Lm and Rm:
            return compute("sub", L.to_list(), R.to_list(), show_steps=show_steps)
        if node.op == "*" and Lm and Rm:
            return compute("multiply", L.to_list(), R.to_list(),
                           show_steps=show_steps)
        if node.op == "*" and Lm and not Rm:
            return compute("scalar", L.to_list(), _one(R), show_steps=show_steps)
        if node.op == "*" and not Lm and Rm:
            return compute("scalar", R.to_list(), _one(L), show_steps=show_steps)
        if node.op == "/" and Lm and not Rm:
            return compute("scalar", L.to_list(), _one(1 / R),
                           show_steps=show_steps)

    # Anything else (A^2, -A, 2*3, a bare name, a composite chain) is evaluated
    # directly: there is no single engine operation to trace.
    return _wrap(_eval(node, lib))

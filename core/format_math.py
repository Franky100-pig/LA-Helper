"""Human-readable rendering of LA Helper's numeric output.

The engine returns exact forms as plain *strings* -- e.g. ``"(-1 + sqrt(5))/2"``,
``"sqrt(5)/2"``, ``"5**(1/3)"`` (a cube root), ``"1/3 + 5**(1/3)/3 ..."``. To a
student or a teacher those read exactly like the opaque "LaTeX math" they
complain about. This module turns them into friendly output from ONE source so
the web and desktop editions agree:

* :func:`to_html` -- stacked fractions, ``√`` radicals, superscript powers and
  ``i`` for the web (rendered as HTML).
* :func:`to_text` -- the same ideas as clean Unicode for the desktop
  (``√``, ``^``, ``i``, optional decimal), since tkinter has no real layout.
* :func:`step_html` / :func:`step_text` -- the REF/LU row-operation lines
  (``R2 → R2 − (3/2)·R1``) with the embedded fractions/roots made readable.

Everything re-parses the string through SymPy, so a single implementation
handles rational, radical, complex and fractional-power expressions.
"""
import re

import sympy as sp

_IMAG = sp.I
_DEC_RE = re.compile(r"^-?\d+(\.\d+)?$")


def _escape(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _safe_expr(s):
    # Default (evaluated) parsing keeps 1/2 as a Rational and 5**(1/3) as a
    # Rational exponent, which the walker relies on; it still leaves
    # sqrt(5), (-1+sqrt(5))/2 etc. structurally intact for display.
    try:
        return sp.sympify(str(s))
    except Exception:
        return None


# --- HTML ------------------------------------------------------------------

def _sup(n):
    table = str.maketrans("0123456789+-", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻")
    return str(n).translate(table)


def _frac_html(num, den):
    return (
        '<span class="frac"><span class="fnum">' + num + "</span>"
        '<span class="fden">' + den + "</span></span>"
    )


def _sqrt_html(body_html, index=None):
    if index is None:
        return '<span class="sqrt">√<span class="rad">' + body_html + "</span></span>"
    return (
        '<span class="sqrt"><span class="radix">' + _sup(index) + "</span>"
        "√<span class=\"rad\">" + body_html + "</span></span>"
    )


def _fmt_float(x):
    if x == int(x):
        return str(int(x))
    return f"{x:.6g}"


def _exp_text(ex):
    if isinstance(ex, sp.Integer):
        return str(ex)
    if isinstance(ex, sp.Rational):
        return f"{ex.p}/{ex.q}"
    return _escape(str(ex))


def _html(e):
    if e is None:
        return ""
    if isinstance(e, sp.Integer):
        s = str(e)
        return s.replace("-", "−") if e < 0 else s
    if isinstance(e, sp.Rational):
        n, d = e.p, e.q
        if d == 1:
            return str(n) if n >= 0 else "−" + str(-n)
        if n < 0:
            return "−" + _frac_html(str(-n), str(d))
        return _frac_html(str(n), str(d))
    if isinstance(e, sp.Float):
        return _fmt_float(float(e))
    if e == _IMAG:
        return "i"
    if isinstance(e, sp.Abs):
        return "|" + _html(e.args[0]) + "|"
    if isinstance(e, sp.Pow):
        b, ex = e.base, e.exp
        if ex == sp.Rational(1, 2):
            return _sqrt_html(_html(b))
        if isinstance(ex, sp.Rational) and ex.p == 1 and ex.q > 2:
            return _sqrt_html(_html(b), ex.q)
        if ex == -1:
            return _frac_html("1", _html(b))
        if ex < 0:
            return _frac_html("1", _html(sp.Pow(b, -ex)))
        return _html(b) + _sup(_exp_text(ex))
    if isinstance(e, sp.Mul):
        sign = ""
        coeff = sp.Integer(1)
        rest = []
        for f in e.args:
            if isinstance(f, (sp.Rational, sp.Integer, sp.Float)):
                coeff *= f
            else:
                rest.append(f)
        c = coeff
        if c < 0:
            sign = "−"
            c = -c
        if not rest:
            return sign + _html(c)
        rest_html = "".join(_html(r) for r in rest)
        need_paren = (len(rest) > 1) or isinstance(rest[0], sp.Add)
        if need_paren:
            rest_html = "(" + rest_html + ")"
        if isinstance(c, sp.Rational) and c.q != 1:
            num = rest_html
            if c.p != 1:
                sep = "" if not need_paren else "·"
                num = _html(sp.Integer(c.p)) + sep + rest_html
            return sign + _frac_html(num, str(c.q))
        coeff_html = "" if c == 1 else _html(c)
        sep = ""
        if coeff_html and not (len(rest) == 1 and rest[0] == _IMAG):
            sep = "·"
        return sign + coeff_html + sep + rest_html
    if isinstance(e, sp.Add):
        parts = []
        for i, t in enumerate(e.args):
            h = _html(t)
            if h.startswith("−"):
                h = h[1:]
                op = "" if i == 0 else " − "
            else:
                op = "" if i == 0 else " + "
            parts.append(op + h)
        return "".join(parts)
    # Fallback: never throw on an unexpected expression.
    return _escape(str(e))


def to_html(s):
    """Render a scalar string as friendly HTML (fractions, √, i, decimals)."""
    s = str(s)
    if _DEC_RE.match(s):
        return s.replace("-", "−")  # plain integer/decimal passes through
    e = _safe_expr(s)
    if e is None:
        return _escape(s)
    return _html(e)


def step_label(step):
    """Text of a recorded step.

    A step is ``{"text": ..., "matrix": ...}``; a bare string is still accepted
    so older callers (and hand-written steps) keep working.
    """
    if isinstance(step, dict):
        return str(step.get("text", ""))
    return str(step)


def step_html(step):
    """Make a REF/LU row-operation line readable (fractions + √ as HTML)."""
    t = _escape(step_label(step))
    t = re.sub(r"sqrt\(([^()]*)\)", r"√\1", t)
    t = re.sub(
        r"\((-?\d+)/(-?\d+)\)",
        lambda m: _frac_html(m.group(1), m.group(2)),
        t,
    )
    return t


# --- Plain text (desktop) --------------------------------------------------

def to_text(s, decimals=False):
    """Render a scalar string as clean Unicode text for the desktop.

    With ``decimals=True`` a real value is shown as a rounded decimal; otherwise
    exact forms are cleaned (``sqrt(5)`` -> ``√5``, ``**`` -> ``^``, ``I`` -> ``i``).
    """
    s = str(s)
    if decimals:
        try:
            val = sp.N(_safe_expr(s) if _safe_expr(s) is not None else s, 8)
            if getattr(val, "is_real", False):
                f = float(val)
                if f == int(f):
                    return str(int(f))
                return f"{f:.4f}"
        except Exception:
            pass
    t = re.sub(r"sqrt\(([^()]*)\)", r"√\1", s)
    t = t.replace("**", "^")
    t = re.sub(r"(?<![\w])I(?![\w])", "i", t)
    return t


def step_text(step):
    """Clean a REF/LU row-operation line for the desktop."""
    t = re.sub(r"sqrt\(([^()]*)\)", r"√\1", step_label(step))
    t = t.replace("**", "^")
    return re.sub(r"(?<![\w])I(?![\w])", "i", t)

"""Headless render tests for the desktop (tkinter) edition.

The desktop UI imports tkinter, which is unavailable in CI / headless runs.
We stub the tkinter package with a recursive Stand-in so the real
``render_result`` logic can be exercised and asserted on.

These tests guarantee the desktop output stays friendly and in sync with the
web edition: stacked fractions / radicals for exact forms, a prominent decimal
``≈`` only when it actually helps, clean decimals for unwieldy exact forms, and
no raw ``sqrt`` / ``**`` / ``I`` leaking into the text.
"""
import sys
import types


class _Stub:
    """Recursive module stand-in: any attribute is a fresh class (so it can be
    used as a base class) and the top-level submodules chain further."""

    def __init__(self):
        self._c = {}

    def __getattr__(self, name):
        if name not in self._c:
            self._c[name] = type(name, (), {})
        return self._c[name]


_tk = _Stub()
sys.modules["tkinter"] = _tk
for _sub in ("font", "ttk", "scrolledtext", "simpledialog", "messagebox", "filedialog"):
    _s = _Stub()
    _tk._c[_sub] = _s
    sys.modules["tkinter." + _sub] = _s

from core import engine  # noqa: E402
import desktop.app as app_mod  # noqa: E402


class _FakeText:
    def __init__(self):
        self.lines = []

    def config(self, *a, **k):
        pass

    def delete(self, *a, **k):
        self.lines = []

    def insert(self, *a, **k):
        if a:
            self.lines.append(a[0])


class _Harness(app_mod.LAApp):
    def __init__(self, dec=False):
        self.out = _FakeText()
        self.dec_var = types.SimpleNamespace(get=lambda: dec)
        self._captured = []

    def _write(self, text, tag=None):
        self._captured.append(text)

    def _fit_result_height(self):
        pass

    def lines(self):
        return self._captured

    @classmethod
    def render(cls, A, op="eigen", dec=False, show_steps=False):
        res = engine.dispatch({"op": op, "A": A, "showSteps": show_steps})
        h = cls(dec)
        h.render_result(res)
        return h._captured


def test_readable_exact_shows_fraction_and_approx():
    out = _Harness.render([[1, 1], [1, 0]])
    text = "\n".join(out)
    assert "λ = 1/2 - √5/2" in text
    assert "≈ -0.6180" in text          # decimal shown for a radical form
    assert "1/2 + √5/2" in text


def test_pure_imaginary_unit_has_no_pointless_approx():
    out = _Harness.render([[0, -1], [1, 0]])
    text = "\n".join(out)
    assert "λ = i" in text
    assert "λ = -i" in text
    # no noisy "≈ 1.0*i" next to a value that is already clear
    assert "≈ 1.0*i" not in text
    assert "≈ -1.0*i" not in text


def test_unwieldy_exact_falls_back_to_decimal_without_sqrt_noise():
    out = _Harness.render([[3, 5, 6], [2, 6, 7], [1, 4, 7]])
    text = "\n".join(out)
    assert "λ = 1.93005" in text
    assert "λ = 13.3315" in text
    # the monster Cardano form must never reach the user as raw text
    assert "sqrt" not in text
    assert "**" not in text
    assert "I" not in text


def test_ref_steps_render_cleanly():
    out = _Harness.render([[2, 1, 1], [4, 1, 3], [-2, 2, 1]], op="ref", show_steps=True)
    text = "\n".join(out)
    assert "计算步骤" in text
    assert "R2 → R2 − (2)·R1" in text     # fractions + unicode minus, no **/sqrt
    assert "**" not in text


def test_lu_matrices_show_fractions_not_sqrt():
    out = _Harness.render([[2, 1, 1], [4, 1, 3], [-2, 2, 1]], op="lu")
    text = "\n".join(out)
    assert "1/2" in text                  # exact fraction preserved
    assert "L（单位下三角）" in text

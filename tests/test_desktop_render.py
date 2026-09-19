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


# ---------------------------------------------------------------------------
# 深 / 浅色主题：两套调色板、可切换、并持久化到设置文件。
# 只挂载主题相关方法，避免构建整个 UI（tkinter 在无显示环境下不可用）。
# ---------------------------------------------------------------------------
class _FakeRoot:
    def configure(self, **k):
        pass

    def tk_setPalette(self, **k):
        pass


class _Noop:
    def __getattr__(self, name):
        return lambda *a, **k: None


class _FakeTTK:
    def Style(self):
        return _Noop()


class _ThemeHarness:
    _style = app_mod.LAApp._style
    apply_theme = app_mod.LAApp.apply_theme
    _refresh_widget_colors = app_mod.LAApp._refresh_widget_colors
    _sync_theme_btn = app_mod.LAApp._sync_theme_btn
    toggle_theme = app_mod.LAApp.toggle_theme

    def __init__(self):
        self.root = _FakeRoot()
        self._btn = None
        self.theme_btn_var = types.SimpleNamespace(
            set=lambda v: setattr(self, "_btn", v))


def test_theme_has_both_palettes_and_soft_light(monkeypatch, tmp_path):
    monkeypatch.setattr(app_mod, "ttk", _FakeTTK())
    monkeypatch.setattr(app_mod, "CONFIG_PATH", str(tmp_path / "s.json"))
    h = _ThemeHarness()
    h._style()
    pal = h._palettes
    assert set(pal) == {"dark", "light"}
    for p in pal.values():
        for key in ("bg", "panel", "text", "muted", "accent", "field"):
            assert key in p
    # 浅色底不刺眼：不用纯白底 / 纯黑字
    assert pal["light"]["bg"] != "#ffffff"
    assert pal["light"]["text"] != "#000000"


def test_theme_defaults_dark_then_toggles_and_persists(monkeypatch, tmp_path):
    import json
    monkeypatch.setattr(app_mod, "ttk", _FakeTTK())
    cfg = tmp_path / "s.json"
    monkeypatch.setattr(app_mod, "CONFIG_PATH", str(cfg))

    h = _ThemeHarness()
    h._style()
    assert h.theme == "dark"
    assert h.colors["bg"] == "#1e262e"
    assert h._btn == "浅色"                       # 深色时按钮提示可切到浅色

    h.toggle_theme()
    assert h.theme == "light"
    assert h.colors["bg"] == "#eef1f5"
    assert h._btn == "深色"
    assert json.loads(cfg.read_text())["theme"] == "light"   # 已持久化

    h.toggle_theme()
    assert h.theme == "dark"
    assert json.loads(cfg.read_text())["theme"] == "dark"


def test_theme_restored_from_settings(monkeypatch, tmp_path):
    monkeypatch.setattr(app_mod, "ttk", _FakeTTK())
    cfg = tmp_path / "s.json"
    cfg.write_text('{"theme": "light"}', encoding="utf-8")
    monkeypatch.setattr(app_mod, "CONFIG_PATH", str(cfg))
    h = _ThemeHarness()
    h._style()
    assert h.theme == "light"
    assert h.colors["bg"] == "#eef1f5"

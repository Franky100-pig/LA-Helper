"""桌面端的新手引导：载入示例 / 记住进度 / 讲义推荐。

这些方法挂在 tkinter 窗口上，直接测不方便，所以沿用 test_desktop_render.py
的做法：把方法借到一个只有桩属性的假对象上跑（不需要显示器）。

注意：进度存取要拦在 app_mod.load_settings / save_settings 上。这里用
``monkeypatch`` 自动还原，而不是直接赋值 —— 直接赋值会**永久污染模块全局**，
让另一个测试文件（test_desktop_render 的主题持久化用例）读到假的存储，
表现为「单独跑通过、一起跑失败」。
"""
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core import engine, examples as core_examples   # noqa: E402
from desktop import app as app_mod                   # noqa: E402
from desktop.model import LibraryModel               # noqa: E402


@pytest.fixture(autouse=True)
def _isolate_settings(monkeypatch):
    """每个用例都把设置读写换成内存字典，跑完自动还原。

    否则 save_progress 会写开发者真实的 ~/.la_helper_settings.json，
    还会顺手抹掉 theme / api_key。
    """
    box = {}
    monkeypatch.setattr(app_mod, "load_settings", lambda: dict(box))
    monkeypatch.setattr(app_mod, "save_settings",
                        lambda d: (box.clear(), box.update(d)))
    _isolate_settings.box = box
    yield box


class _Var:
    def __init__(self, v=None):
        self._v = v

    def get(self):
        return self._v

    def set(self, v):
        self._v = v


class _CB:
    """ttk.Combobox 的一小部分：current() 既读也写。"""

    def __init__(self, index=0):
        self._i = index

    def current(self, i=None):
        if i is not None:
            self._i = i
        return self._i


class _CBOpts(dict):
    """操作数下拉框的桩。

    refresh_operand_options 会用到 sel["values"]=…、pack/pack_forget/lift 等
    一堆 tkinter 方法。与其一个个补（补漏一个就红一次），不如把未知属性
    一律变成空操作 —— 这里要验的是**进度存取逻辑**，不是 tkinter。
    """

    def __getattr__(self, name):
        return lambda *a, **k: None


def make_app(op_key="det", det_label=None, lib=None, storage=None):
    """搭一个只含所需桩属性的假 LAApp。"""
    a = types.SimpleNamespace()
    a.model = LibraryModel()
    if lib is not None:
        a.model.lib = lib
    a.op_cb = _CB([k for k, _ in app_mod.OPS].index(op_key))
    # ttk.Combobox 支持 sel["values"] = ...，所以用 dict 子类而不是 SimpleNamespace
    a.left_cb = _CBOpts()
    a.right_cb = _CBOpts()
    a.det_method_cb = _CBOpts()
    a._left_lbl = _CBOpts()
    a._det_cb_shown = False
    a.det_method_var = _Var(det_label or app_mod.DET_METHODS[0])
    a.steps_var = _Var(True)
    a.dec_var = _Var(False)
    a.left_var = _Var("A")
    a.right_var = _Var("A")
    a.expr_var = _Var("")
    a.last_op = None
    a.rendered = []
    a.packed = []
    a._article_note = None
    # 类属性，SimpleNamespace 不会继承，得显式搬过来
    a.PROGRESS_VERSION = app_mod.LAApp.PROGRESS_VERSION

    # 借真方法
    for name in ("_op_key", "_det_op", "_det_label", "load_example",
                 "apply_example", "save_progress", "restore_progress",
                 "clear_progress", "refresh_operand_options", "_sync_det_method"):
        setattr(a, name, getattr(app_mod.LAApp, name).__get__(a, type(a)))

    # 桩掉会碰 tkinter 的部分
    a.refresh_all = lambda: None
    a.render_result = lambda res: a.rendered.append(res)
    a._compute = lambda: _compute(a)
    a.compute_dropdown = a._compute
    a._article_btn_var = _Var("")
    a.article_btn = types.SimpleNamespace(
        pack=lambda **kw: a.packed.append(True),
        pack_forget=lambda: a.packed.clear(),
    )

    # 存读取的是 autouse fixture 拦下的内存字典；若给了 storage 就预置进去
    box = getattr(_isolate_settings, "box", None)
    if box is None:          # fixture 没跑（例如直接调 make_app）
        box = {}
    if storage:
        box.clear()
        box.update(storage)
    a._box = box
    return a


def _compute(a):
    raw = a._op_key()
    op = a._det_op() if raw == "det" else raw
    payload = {"op": op, "A": a.model.data_of(a.left_var.get()),
               "showSteps": a.steps_var.get()}
    if raw in app_mod.OPS_NEED_B:
        payload["B"] = a.model.data_of(a.right_var.get())
    a.last_op = raw
    a.render_result(engine.dispatch(payload))
    a.save_progress()


# ==== 载入示例 ===============================================================
def test_every_operation_has_a_loadable_example():
    for key, _ in app_mod.OPS:
        assert core_examples.example_for(key) is not None, f"{key} 没有示例"


def test_load_example_fills_and_computes():
    a = make_app("eigen")
    a.load_example()
    ex = core_examples.example_for("eigen")
    assert a.model.lib["A"]["cells"] == ex["A"]
    # 关键：示例应该**直接算出来**，而不是让用户再点一次「计算」
    assert len(a.rendered) == 1 and a.rendered[0]["ok"]


def test_load_example_drops_unused_matrices():
    a = make_app("transpose")
    a.model.lib["C"] = {"rows": 1, "cols": 1, "cells": [["7"]]}
    a.load_example()
    assert sorted(a.model.lib) == ["A"]


def test_apply_example_selects_operation_and_operands():
    st = next(s for s in core_examples.STARTERS if s["id"] == "startSolve")
    a = make_app("det")
    a.apply_example(st)
    assert a._op_key() == "solve"
    assert a.left_var.get() == "A" and a.right_var.get() == "B"


def test_starter_with_cofactor_sets_det_method():
    st = next(s for s in core_examples.STARTERS if s["id"] == "startCofactor")
    a = make_app("det", det_label=app_mod.DET_METHODS[0])
    a.apply_example(st)
    assert a._op_key() == "det"
    assert a.det_method_var.get() == app_mod.DET_METHODS[1]
    # 引擎侧要真的走 det_cofactor
    assert a._det_op() == "det_cofactor"


def test_singular_starter_reports_no_inverse():
    """这个场景的全部价值就在于「算不出来，且说清为什么」。"""
    st = next(s for s in core_examples.STARTERS if s["id"] == "startSingular")
    a = make_app("inverse")
    a.apply_example(st)
    res = a.rendered[0]
    assert res["type"] == "inverse_status" and res["exists"] is False


def test_every_starter_computes():
    for st in core_examples.STARTERS:
        a = make_app(st["op"])
        a.apply_example(st)
        assert a.rendered, f"{st['id']} 没有产出结果"
        if st["id"] != "startSingular":
            assert a.rendered[0]["ok"], f"{st['id']} 引擎返回失败"


# ==== 记住进度 ===============================================================
def test_progress_round_trip():
    # 第一次「打开应用」：填点东西、算一次，于是存下了
    a = make_app("rank")
    a.model.lib["A"]["cells"] = [["1", "2"], ["3", "4"]]
    a.model.lib["A"]["rows"] = 2
    a.model.lib["A"]["cols"] = 2
    a.model.editing = "A"
    a.dec_var.set(True)
    a.expr_var.set("det(A)")
    a._compute()
    saved = dict(a._box)          # 存盘后的内容

    # 第二次「打开应用」：同一个存储，应该原样还原
    b = make_app("multiply", storage=saved)
    assert b.restore_progress() is True
    assert b.model.lib["A"]["cells"] == [["1", "2"], ["3", "4"]]
    assert b._op_key() == "rank"
    assert b.dec_var.get() is True
    assert b.expr_var.get() == "det(A)"


@pytest.mark.parametrize("bad", [
    None,
    "not-a-dict",
    {"v": 99, "lib": {"A": {"cells": [["1"]]}}},          # 版本不认
    {"v": 1},                                                # 缺 lib
    {"v": 1, "lib": {}},                                     # 空 lib
    {"v": 1, "lib": {"A": {"cells": [["1", "2"], ["3"]]}}},  # 行长度不齐
    {"v": 1, "lib": {"A": {"cells": "nope"}}},               # 不是二维数组
    {"v": 1, "lib": {"A": {"cells": [[]]}}},                 # 零列
    {"v": 1, "lib": {"9bad name": {"cells": [["1"]]}}},      # 非法矩阵名
    {"v": 1, "lib": {"A": {"cells": [["1"]] * 99}}},         # 超出 MAX_DIM
])
def test_bad_progress_falls_back_to_defaults(bad):
    storage = {} if bad is None else {"progress": bad}
    a = make_app("multiply", storage=storage)
    assert a.restore_progress() is False
    # 仍然是默认的 3x3 空白网格，没有白屏也没有半吊子状态
    assert a.model.lib["A"]["rows"] == 3 and a.model.lib["A"]["cols"] == 3
    assert a.model.lib["A"]["cells"] == [["", "", ""]] * 3


def test_progress_ignores_bad_matrices_but_keeps_good_ones():
    a = make_app("multiply", storage={"progress": {
        "v": 1,
        "lib": {
            "A": {"cells": [["1", "2"], ["3", "4"]]},
            "B": {"cells": [["1", "2"], ["3"]]},   # 行长度不齐 → 丢弃
        },
    }})
    assert a.restore_progress() is True
    assert sorted(a.model.lib) == ["A"]


def test_clear_progress_resets_everything():
    a = make_app("eigen")
    a.model.lib["A"]["cells"] = [["9"]]
    a._compute()
    assert "progress" in a._box

    a.clear_progress()
    assert "progress" not in a._box
    assert a.model.lib["A"]["rows"] == 3
    assert a.model.lib["A"]["cells"] == [["", "", ""]] * 3
    assert a.expr_var.get() == ""


def test_save_progress_never_raises_when_storage_is_broken():
    a = make_app("det")
    def boom(_d):
        raise OSError("read-only file system")
    app_mod.save_settings = boom
    a.model.lib["A"]["cells"] = [["1"]]
    a.save_progress()          # 不抛异常就算过


# ==== 讲义推荐 ===============================================================
def test_article_button_appears_for_mapped_operation():
    a = make_app("cofactor_matrix")
    a._compute()
    app_mod.LAApp._write_article_hint(a, raw_op="cofactor_matrix",
                                      det_method=app_mod.DET_METHODS[0])
    assert a.packed, "有对应讲义时按钮应显示"
    assert a._article_note == "adjugate"
    assert "伴随矩阵" in a._article_btn_var.get()


def test_article_button_stays_hidden_without_an_honest_match():
    for key in ("add", "sub", "transpose", "scalar"):
        a = make_app(key)
        app_mod.LAApp._write_article_hint(a, raw_op=key,
                                          det_method=app_mod.DET_METHODS[0])
        assert a.packed == [], f"{key} 没有对应讲义，不该显示"
        assert a._article_note is None


def test_article_button_hidden_when_op_unknown():
    a = make_app("det")
    app_mod.LAApp._write_article_hint(a, raw_op=None,
                                      det_method=app_mod.DET_METHODS[0])
    assert a.packed == [] and a._article_note is None


def test_det_recommendation_depends_on_the_algorithm():
    a = make_app("det", det_label=app_mod.DET_METHODS[0])
    app_mod.LAApp._write_article_hint(a, raw_op="det",
                                      det_method=app_mod.DET_METHODS[0])
    assert a._article_note == "row-reduction"
    app_mod.LAApp._write_article_hint(a, raw_op="det",
                                      det_method=app_mod.DET_METHODS[1])
    assert a._article_note == "cofactor"


def test_article_url_points_at_the_online_note():
    a = make_app("rank")
    opened = []
    a._open_article = lambda nid: opened.append(nid)
    a._article_note = "rank"
    app_mod.LAApp._open_article_from_btn(a)
    assert opened == ["rank"]
    assert app_mod.NOTES_BASE_URL.endswith("notes.html")

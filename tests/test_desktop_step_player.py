"""桌面端单步播放器（step player）的逻辑测试。

播放器挂在 tkinter 窗口上，直接构造真窗口需要显示器，所以沿用
test_desktop_render / test_desktop_onboarding 的做法：把真实的播放方法借到
一个只有桩属性的假对象上跑。

这里重点锁住一个曾经的真实 bug —— 播放调度写成了 ``self.after`` /
``self.after_cancel``，但 ``LAApp`` 不是 Tk 控件，没有 ``after`` 方法，点
「▶」会自动播放时会直接 ``AttributeError``。正确写法是 ``self.root.after``。
"""
import sys
import types

import pytest


class _Stub:
    """递归模块替身：任何属性都是可当基类用的新类（沿用 test_desktop_render）。"""

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

from desktop import app as app_mod  # noqa: E402


class _Var:
    def __init__(self, v=None):
        self._v = v

    def get(self):
        return self._v

    def set(self, v):
        self._v = v


class _FakeRoot:
    """记录 after / after_cancel 的调用，但不真正起定时器。"""

    def __init__(self):
        self.after_calls = []
        self.after_cancel_calls = []
        self._job = 0

    def after(self, ms, cb):
        self._job += 1
        self.after_calls.append((ms, cb))
        return ("job", self._job)

    def after_cancel(self, job):
        self.after_cancel_calls.append(job)


class _FakeText:
    """记录插入的 (文本, tag)，足以断言高亮逻辑。"""

    def __init__(self):
        self.inserts = []

    def config(self, *a, **k):
        pass

    def delete(self, *a, **k):
        self.inserts = []

    def insert(self, *a, **k):
        # tkinter Text.insert(index, chars, tagName=None)
        text = a[1] if len(a) > 1 else k.get("chars")
        tag = a[2] if len(a) > 2 else k.get("tagName")
        self.inserts.append((text, tag))


def make_player(steps):
    a = types.SimpleNamespace()
    a.root = _FakeRoot()
    a.dec_var = _Var(False)
    a.steps_var = _Var(True)
    a._steps = []
    a._step_idx = 0
    a._playing = False
    a._play_job = None
    a.step_out = _FakeText()
    a.step_label_var = _Var("")
    a.step_pos_var = _Var("")
    a.play_btn = types.SimpleNamespace(config=lambda **k: None)
    a.player = types.SimpleNamespace(
        pack=lambda **k: None, pack_forget=lambda: None)

    # 借真方法
    for name in ("_set_steps", "_render_step", "_step_goto", "_step_first",
                 "_step_last", "_step_prev", "_step_next", "_toggle_play",
                 "_play_tick", "_stop_play", "_config_step_tags"):
        setattr(a, name, getattr(app_mod.LAApp, name).__get__(a, type(a)))
    return a


# 手写两步，方便断言 pivot / rows 高亮
STEPS = [
    {"text": "R2 ← R2 − 2·R1", "matrix": [[2, 1, 1], [0, -1, 1], [-2, 2, 1]],
     "op": "eliminate", "pivot": {"row": 0, "col": 0, "value": "2"}, "rows": [1]},
    {"text": "R3 ← R3 + R1", "matrix": [[2, 1, 1], [0, -1, 1], [0, 3, 2]],
     "op": "eliminate", "pivot": {"row": 0, "col": 0, "value": "2"}, "rows": [2]},
    {"text": "det(A) = det(P)·det(L)·det(U)", "op": "note"},  # 无矩阵快照
]


def test_set_steps_populates_and_renders_first():
    a = make_player(STEPS)
    a._set_steps(STEPS)
    assert a._steps == STEPS
    assert a._step_idx == 0
    # 第一步渲染：主元行 0 是 pv，改动行 1 是 hl，行 2 无高亮
    tags = [t for (_line, t) in a.step_out.inserts]
    assert tags[0] == "pv"
    assert tags[1] == "hl"
    assert tags[2] is None


def test_set_steps_empty_hides_player():
    a = make_player([])
    packed = []
    a.player = types.SimpleNamespace(
        pack=lambda **k: None, pack_forget=lambda: packed.append(True))
    a._set_steps([])
    assert a._steps == []
    assert packed == [True]          # pack_forget 被调用 → 播放器隐藏


def test_navigation_moves_index_and_rerenders():
    a = make_player(STEPS)
    a._set_steps(STEPS)
    a._step_next()
    assert a._step_idx == 1
    a._step_next()
    assert a._step_idx == 2
    a._step_prev()
    assert a._step_idx == 1
    a._step_first()
    assert a._step_idx == 0
    a._step_last()
    assert a._step_idx == 2


def test_note_step_without_matrix_shows_placeholder():
    a = make_player(STEPS)
    a._set_steps(STEPS)
    a._step_last()                  # 第三步是纯说明步骤
    texts = [line for (line, _t) in a.step_out.inserts]
    assert any("说明性步骤" in t for t in texts)


def test_play_schedules_on_root_not_self():
    """回归测试：之前写成 self.after，点 ▶ 会 AttributeError。"""
    a = make_player(STEPS)
    a._set_steps(STEPS)
    a._toggle_play()
    assert a._playing is True
    # 调度必须挂在 root 上：after 被调用、且回调是 _play_tick
    assert a.root.after_calls, "play 没有调度定时器"
    ms, cb = a.root.after_calls[0]
    assert ms == 1500
    assert cb.__func__ is app_mod.LAApp._play_tick


def test_stop_play_cancels_pending_job():
    a = make_player(STEPS)
    a._set_steps(STEPS)
    a._toggle_play()
    job = a._play_job
    assert job is not None
    a._stop_play()
    assert a._playing is False
    assert a.root.after_cancel_calls == [job]
    assert a._play_job is None


def test_play_tick_advances_and_reschedules():
    a = make_player(STEPS)
    a._set_steps(STEPS)
    a._toggle_play()
    before = a._step_idx
    # 模拟定时器触发：直接调 _play_tick
    a._play_tick()
    assert a._step_idx == before + 1
    # 还没到末尾 → 又调度了一次
    assert len(a.root.after_calls) == 2


def test_play_tick_stops_at_end():
    a = make_player(STEPS)
    a._set_steps(STEPS)
    a._step_last()
    a._playing = True
    a._play_tick()                  # 已在末尾 → 应停止
    assert a._playing is False
    # 末尾不再调度
    assert len(a.root.after_calls) == 0

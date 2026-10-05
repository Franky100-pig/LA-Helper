"""Tests for the desktop in-app update check (desktop/update.py).

Pure logic + a monkeypatched HTTP layer, so no real network access and no
tkinter needed. Covers the version comparison edge cases (the part most likely
to cause a wrong "new version" prompt) and the "offline must stay silent"
behaviour.
"""
import io
import json

from desktop import update as update_mod


# ---- 版本比较 -------------------------------------------------------------
def test_is_newer_detects_newer_tag():
    assert update_mod.is_newer("v0.6.0", "0.5.0")
    assert update_mod.is_newer("0.6.0", "0.5.9")
    assert update_mod.is_newer("v1.0.0", "0.99.99")


def test_is_newer_same_or_older_is_false():
    assert not update_mod.is_newer("v0.5.0", "0.5.0")
    assert not update_mod.is_newer("v0.4.9", "0.5.0")
    assert not update_mod.is_newer("0.5.0", "v0.5.0")   # "v" 前缀不影响


def test_is_newer_pads_short_versions():
    # "1.2" 与 "1.2.0" 是同一版本，不能误报
    assert not update_mod.is_newer("1.2", "1.2.0")
    assert not update_mod.is_newer("v1.2", "1.2.0")
    assert update_mod.is_newer("1.2.1", "1.2")


def test_is_newer_garbage_is_conservative():
    # 解析不出数字时宁可漏报，也不误报
    assert not update_mod.is_newer("nightly", "0.5.0")
    assert not update_mod.is_newer("", "0.5.0")
    assert not update_mod.is_newer(None, "0.5.0")
    assert not update_mod.is_newer("v0.6.0", "")


# ---- 网络层（monkeypatch，不真的联网）--------------------------------------
class _FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def _patch_release(monkeypatch, payload):
    def fake_urlopen(req, timeout=None):
        return _FakeResp(json.dumps(payload).encode("utf-8"))
    monkeypatch.setattr(update_mod.urllib.request, "urlopen", fake_urlopen)


def test_fetch_latest_release_parses_tag_and_url(monkeypatch):
    _patch_release(monkeypatch, {
        "tag_name": "v0.6.0",
        "html_url": "https://github.com/x/y/releases/tag/v0.6.0",
        "body": "### 本次更新\n\n**双语**\n- 界面与推导都跟着语言走\n",
    })
    tag, url, body = update_mod.fetch_latest_release()
    assert tag == "v0.6.0"
    assert url.endswith("/releases/tag/v0.6.0")
    assert "双语" in body


def test_fetch_latest_release_body_may_be_missing(monkeypatch):
    # Release 没写说明时 body 是空串，不是 None —— 调用方不必判空
    _patch_release(monkeypatch, {"tag_name": "v0.7.0"})
    tag, url, body = update_mod.fetch_latest_release()
    assert (tag, body) == ("v0.7.0", "")


def test_fetch_latest_release_falls_back_to_releases_page(monkeypatch):
    _patch_release(monkeypatch, {"tag_name": "v0.7.0"})   # 没有 html_url
    tag, url, _body = update_mod.fetch_latest_release()
    assert tag == "v0.7.0"
    assert url == update_mod.RELEASES_PAGE


def test_fetch_latest_release_returns_none_on_network_error(monkeypatch):
    def boom(req, timeout=None):
        raise OSError("no network")
    monkeypatch.setattr(update_mod.urllib.request, "urlopen", boom)
    assert update_mod.fetch_latest_release() is None


def test_fetch_latest_release_returns_none_without_tag(monkeypatch):
    _patch_release(monkeypatch, {"message": "Not Found"})
    assert update_mod.fetch_latest_release() is None


# ---- check_for_update 状态 -------------------------------------------------
def test_check_for_update_new(monkeypatch):
    monkeypatch.setattr(update_mod, "fetch_latest_release",
                        lambda timeout=6.0: ("v0.6.0", "http://x/y", ""))
    res = update_mod.check_for_update("0.5.0")
    assert res["status"] == update_mod.NEW
    assert res["tag"] == "v0.6.0"
    assert res["url"] == "http://x/y"
    assert res["notes"] == ""      # 没有说明也不报错


def test_check_for_update_latest(monkeypatch):
    monkeypatch.setattr(update_mod, "fetch_latest_release",
                        lambda timeout=6.0: ("v0.6.0", "http://x/y", ""))
    assert update_mod.check_for_update("0.6.0")["status"] == update_mod.LATEST


def test_check_for_update_error_is_silent(monkeypatch):
    monkeypatch.setattr(update_mod, "fetch_latest_release",
                        lambda timeout=6.0: None)
    # 断网：状态是 error（启动时调用方据此保持静默，不打扰用户）
    assert update_mod.check_for_update("0.6.0")["status"] == update_mod.ERROR


# ---- 更新要点（弹窗里给人看的那段）-----------------------------------------
# 真实 v0.7.0 说明的节选，形状必须和线上一致：### 标题 + **小节** + - 条目 + 表格
_V070_BODY = """### 本次更新（v0.6.1 → v0.7.0）

**界面与推导彻底双语**
- 引擎输出的每一步说明、每一条报错都跟着界面语言走（中 ⇄ 英）
- 修掉 8 处「中文界面里混进英文」的步骤文案

**步骤结构化 + 单步播放（网页版 / 在线预览版）**
- 每一步都带机器可读的矩阵快照与当前主元
- 播放器：⏮ ◀ ▶/❚❚ ▶| + 步数计数；逐步模式下
  主元格描框、被改动的那一行淡色高亮
- **默认仍然全部展开**——只想通读推导的人什么都不用点

### 下载

| 你的系统 | 下载 | 说明 |
|---|---|---|
| macOS | `LA-Helper-macOS-arm64.zip` | 解压后双击 |

不想下载安装包？在线预览版（无需安装，浏览器直接跑）：
https://la-helper.app.workbuddy.host/
"""


def test_release_highlights_keeps_sections_and_bullets():
    out = update_mod.release_highlights(_V070_BODY)
    assert "界面与推导彻底双语" in out
    assert "每一步都带机器可读的矩阵快照与当前主元" in out
    # 下载表格、### 标题、"### 下载" 都不该出现在弹窗里
    assert "下载" not in out
    # 注意别写成 `"\|" not in out` —— 要点里有「▶|」这个播放器符号本身
    assert not any(line.startswith("|") for line in out.splitlines())
    assert "本次更新" not in out


def test_release_highlights_strips_inline_markdown():
    # tkinter 不会渲染 markdown：星号与反引号必须去掉，否则照原样显示给用户
    out = update_mod.release_highlights(_V070_BODY)
    assert "**" not in out
    assert "`" not in out
    assert "默认仍然全部展开" in out


def test_release_highlights_respects_limits():
    many = "**小节**\n" + "".join(f"- 第 {i} 条\n" for i in range(30))
    out = update_mod.release_highlights(many)
    assert len(out.splitlines()) <= 8
    long_line = "- " + "很长的说明" * 200
    clipped = update_mod.release_highlights("**小节**\n" + long_line)
    assert len(clipped) <= 421 and clipped.endswith("…")


def test_release_highlights_empty_is_empty():
    assert update_mod.release_highlights("") == ""
    assert update_mod.release_highlights(None) == ""
    # 只有表格 / 标题，没有要点可摘
    assert update_mod.release_highlights("### 下载\n\n| a | b |\n") == ""


def test_check_for_update_passes_notes_through(monkeypatch):
    monkeypatch.setattr(update_mod, "fetch_latest_release",
                        lambda timeout=6.0: ("v0.7.0", "http://x", _V070_BODY))
    res = update_mod.check_for_update("0.6.1")
    assert res["status"] == update_mod.NEW
    assert "单步播放" in res["notes"]


def test_release_highlights_joins_wrapped_bullets():
    out = update_mod.release_highlights(_V070_BODY)
    # 折行的条目要接回上一条，不能停在「逐步模式下」这种半句
    assert "逐步模式下主元格描框、被改动的那一行淡色高亮" in out
    assert "逐步模式下\n" not in out


def test_release_highlights_ignores_paragraph_after_table():
    out = update_mod.release_highlights(_V070_BODY)
    # 表格后面那段"不想下载安装包…"是段落，不该被接进最后一条要点
    # （用这段的独特措辞查，别用"在线预览版"——小节标题里也有这四个字）
    assert "不想下载安装包" not in out

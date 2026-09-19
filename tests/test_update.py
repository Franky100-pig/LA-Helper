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
    })
    tag, url = update_mod.fetch_latest_release()
    assert tag == "v0.6.0"
    assert url.endswith("/releases/tag/v0.6.0")


def test_fetch_latest_release_falls_back_to_releases_page(monkeypatch):
    _patch_release(monkeypatch, {"tag_name": "v0.7.0"})   # 没有 html_url
    tag, url = update_mod.fetch_latest_release()
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
                        lambda timeout=6.0: ("v0.6.0", "http://x/y"))
    res = update_mod.check_for_update("0.5.0")
    assert res["status"] == update_mod.NEW
    assert res["tag"] == "v0.6.0"
    assert res["url"] == "http://x/y"


def test_check_for_update_latest(monkeypatch):
    monkeypatch.setattr(update_mod, "fetch_latest_release",
                        lambda timeout=6.0: ("v0.6.0", "http://x/y"))
    assert update_mod.check_for_update("0.6.0")["status"] == update_mod.LATEST


def test_check_for_update_error_is_silent(monkeypatch):
    monkeypatch.setattr(update_mod, "fetch_latest_release",
                        lambda timeout=6.0: None)
    # 断网：状态是 error（启动时调用方据此保持静默，不打扰用户）
    assert update_mod.check_for_update("0.6.0")["status"] == update_mod.ERROR

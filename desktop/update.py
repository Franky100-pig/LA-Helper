"""检查 GitHub 上是否有新版本（纯标准库，不依赖 tkinter，便于单元测试）。

职责单一：查最新 Release、比版本号、给出下载页地址。
弹窗提示与打开浏览器由 desktop/app.py 负责——这样这一层可以脱开 GUI 测试，
也方便网页版或将来别的入口复用。
"""
import json
import re
import urllib.request

REPO = "Franky100-pig/LA-Helper"
API_LATEST = "https://api.github.com/repos/%s/releases/latest" % REPO
RELEASES_PAGE = "https://github.com/%s/releases/latest" % REPO

# 状态常量
NEW = "new"          # 有新版本
LATEST = "latest"    # 已是最新
ERROR = "error"      # 查不到（断网 / 接口异常 / 还没有任何 Release）


def _parse(v):
    """'v1.2.3' / '1.2' -> (1, 2, 3) / (1, 2)；解析不出数字时返回空元组。"""
    nums = re.findall(r"\d+", str(v or ""))
    return tuple(int(n) for n in nums[:3])


def is_newer(latest, current):
    """latest 是否比 current 新（按 主.次.修订 逐段比较）。

    长度不同时右侧补 0，避免 "1.2" 与 "1.2.0" 被误判为新版本。
    任一侧无法解析时保守返回 False（宁可漏报，不可误报）。
    """
    a, b = _parse(latest), _parse(current)
    if not a or not b:
        return False
    n = max(len(a), len(b))
    a = a + (0,) * (n - len(a))
    b = b + (0,) * (n - len(b))
    return a > b


def fetch_latest_release(timeout=6.0):
    """返回最新 Release 的 (tag, html_url)；失败时返回 None。"""
    req = urllib.request.Request(
        API_LATEST,
        headers={"Accept": "application/vnd.github+json",
                 "User-Agent": "LA-Helper-updater"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    tag = data.get("tag_name")
    if not isinstance(tag, str) or not tag.strip():
        return None
    return tag.strip(), (data.get("html_url") or RELEASES_PAGE)


def check_for_update(current):
    """返回 dict：{'status': NEW|LATEST|ERROR}，NEW 时另带 tag / url。"""
    rel = fetch_latest_release()
    if not rel:
        return {"status": ERROR}
    tag, url = rel
    if is_newer(tag, current):
        return {"status": NEW, "tag": tag, "url": url}
    return {"status": LATEST}

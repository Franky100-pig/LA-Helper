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
    """返回最新 Release 的 (tag, html_url, body)；失败时返回 None。

    ``body`` 一并取回：光有版本号没法告诉用户「这次改了什么」，弹窗里直接
    展示要点比让人点进网页更快。body 缺失时是空串，不影响前两个字段。
    """
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
    return (tag.strip(), (data.get("html_url") or RELEASES_PAGE),
            (data.get("body") or ""))


def release_highlights(body, limit=8, max_chars=420):
    """从 Release 说明里挑出「更新要点」，供弹窗显示。

    只取 Markdown 的小节标题（``**…**``）与条目（``- …``），丢掉下载表格、
    "### 本次更新" 这类标题和说明段落 —— 弹窗空间有限，宁可少而清楚。
    条目在 Release 里常常软换行折成两行，续行会接回上一条，否则弹窗里会出现
    「…；逐步模式下」这种半句。行内 markdown 标记（``**``、`` ` ``）要去掉，
    否则 tkinter 会照原样显示星号。
    """
    if not body:
        return ""
    picked = []
    last_was_bullet = False
    for raw in str(body).splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("- "):
            picked.append(line[2:].strip())
            last_was_bullet = True
        elif line.startswith("**") and line.endswith("**") and len(line) > 4:
            picked.append(line.strip("*").strip())
            last_was_bullet = False
        elif line.startswith("###") or line.startswith("|"):
            last_was_bullet = False        # 标题 / 表格：后面不再接续行
        elif last_was_bullet:
            picked[-1] += line
        if len(picked) >= limit:
            break
    text = "\n".join(p.replace("**", "").replace("`", "") for p in picked)
    if len(text) > max_chars:
        text = text[:max_chars].rstrip() + "…"
    return text


def check_for_update(current):
    """返回 dict：{'status': NEW|LATEST|ERROR}，NEW 时另带 tag / url / notes。

    ``notes`` 是给人看的更新要点摘要（可能为空串，例如 Release 没写说明）。
    """
    rel = fetch_latest_release()
    if not rel:
        return {"status": ERROR}
    tag, url, body = rel
    if is_newer(tag, current):
        return {"status": NEW, "tag": tag, "url": url,
                "notes": release_highlights(body)}
    return {"status": LATEST}

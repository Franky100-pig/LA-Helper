"""Fetch the minimal Pyodide runtime + sympy/mpmath wheels into <out>/pyodide/.

为什么要自托管：cdn.jsdelivr.net 的三个域名在大陆时好时坏，全挂时引擎永远
「加载不出来」。把最小运行时（~20MB）放进部署目录，由 la-bridge.js 以同源
`./pyodide/` 优先加载 —— 引擎加载与页面本身一样可靠，jsDelivr 三源降级为兜底。

文件从哪来：
- 运行时 5 件套（pyodide.js / pyodide.asm.js / pyodide.asm.wasm /
  python_stdlib.zip / pyodide-lock.json）取自官方 npm 包 pyodide@0.26.2
  （npmmirror / npmjs 双源）；
- sympy / mpmath 是纯 Python wheel，取自 PyPI（files.pythonhosted.org /
  清华 tuna 双源，同一 content-addressed 路径）。

⚠️ lock 的 sha256 必须改写：Pyodide 发布的 wheel 去掉了 tests（lock 里
`unvendored_tests: true`），与 PyPI 上游 wheel 字节不同、哈希不同。我们托管
的是上游 wheel，所以要把 pyodide-lock.json 里 sympy/mpmath 的 sha256 改写成
上游摘要，否则 loadPackage 的完整性校验会拒绝安装。

Run:  python tools/fetch_pyodide.py [outdir]
      outdir 默认 $LA_PREVIEW_OUT 或 ../la-preview；产物在 <outdir>/pyodide/。
Cache: ~/.cache/la-pyodide/（$LA_PYODIDE_CACHE 可覆盖），重复构建不重复下载。
"""
import hashlib
import json
import os
import pathlib
import shutil
import sys
import tarfile
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent

PYODIDE_VERSION = "0.26.2"

# 运行时：npm tarball 双源（npmmirror 在大陆快，npmjs 兜底）
TARBALL_URLS = [
    f"https://registry.npmmirror.com/pyodide/-/pyodide-{PYODIDE_VERSION}.tgz",
    f"https://registry.npmjs.org/pyodide/-/pyodide-{PYODIDE_VERSION}.tgz",
]

# tarball 内 package/ 下需要的文件（loadPyodide 会自己去 indexURL 拉
# asm.js / asm.wasm / python_stdlib.zip / pyodide-lock.json 四件）。
RUNTIME_FILES = [
    "pyodide.js",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "python_stdlib.zip",
    "pyodide-lock.json",
]

# wheel：PyPI content-addressed 路径（不可变，可写死），tuna 是同路径镜像。
# sha256 是 PyPI 官方摘要，下载后必须核对 —— 同时写进 lock。
WHEELS = [
    {
        "name": "sympy",
        "file": "sympy-1.12-py3-none-any.whl",
        "sha256": "c3588cd4295d0c0f603d0f2ae780587e64e2efeedb3521e46b9bb1d08d184fa5",
        "path": "d2/05/e6600db80270777c4a64238a98d442f0fd07cc8915be2a1c16da7f2b9e74",
    },
    {
        "name": "mpmath",
        "file": "mpmath-1.3.0-py3-none-any.whl",
        "sha256": "a0b2b9fe80bbcd81a6647ff13108738cfb482d481d826cc0e02f5b35e5c88d2c",
        "path": "43/e3/7d92a15f894aa0c9c4b49b8ee9ac9850d6e63b03c9c32c0367a13ae62209",
    },
]

CACHE = pathlib.Path(
    os.environ.get("LA_PYODIDE_CACHE", pathlib.Path.home() / ".cache" / "la-pyodide")
)


def _download(urls, dest, min_size=1024):
    """下载到 dest，多源顺序尝试；已缓存且够大则跳过。返回最终 URL。"""
    if dest.exists() and dest.stat().st_size >= min_size:
        print(f"  cache hit  {dest.name} ({dest.stat().st_size // 1024} KB)")
        return None
    dest.parent.mkdir(parents=True, exist_ok=True)
    last_err = None
    for url in urls:
        try:
            print(f"  GET {url}")
            req = urllib.request.Request(url, headers={"User-Agent": "la-helper-build"})
            with urllib.request.urlopen(req, timeout=120) as r, open(dest, "wb") as f:
                shutil.copyfileobj(r, f)
            if dest.stat().st_size < min_size:
                raise IOError(f"too small: {dest.stat().st_size} bytes")
            print(f"  ok   {dest.name} ({dest.stat().st_size // 1024} KB)")
            return url
        except Exception as e:  # noqa: BLE001 —— 任一源失败都换下一个
            last_err = e
            print(f"  fail {url}: {e}")
            dest.unlink(missing_ok=True)
    raise SystemExit(f"all sources failed for {dest.name}: {last_err}")


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    out = pathlib.Path(
        sys.argv[1] if len(sys.argv) > 1
        else os.environ.get("LA_PREVIEW_OUT", ROOT.parent / "la-preview")
    )
    dest = out / "pyodide"
    dest.mkdir(parents=True, exist_ok=True)
    print(f"fetch pyodide {PYODIDE_VERSION} -> {dest}")

    # 1) npm tarball -> 运行时 5 件
    tgz = CACHE / f"pyodide-{PYODIDE_VERSION}.tgz"
    _download(TARBALL_URLS, tgz, min_size=1 << 20)
    with tarfile.open(tgz) as tf:
        for name in RUNTIME_FILES:
            member = tf.extractfile(f"package/{name}")
            if member is None:
                raise SystemExit(f"{name} missing from npm tarball")
            (dest / name).write_bytes(member.read())
            print(f"  unpack {name}")

    # 2) wheels -> 校验上游 sha256
    for w in WHEELS:
        urls = [
            f"https://files.pythonhosted.org/packages/{w['path']}/{w['file']}",
            f"https://pypi.tuna.tsinghua.edu.cn/packages/{w['path']}/{w['file']}",
        ]
        cached = CACHE / w["file"]
        _download(urls, cached, min_size=64 * 1024)
        digest = _sha256(cached)
        if digest != w["sha256"]:
            raise SystemExit(
                f"{w['file']}: sha256 mismatch\n  got  {digest}\n  want {w['sha256']}"
            )
        shutil.copyfile(cached, dest / w["file"])
        print(f"  copy {w['file']} (sha256 ok)")

    # 3) 改写 lock 的 sha256：我们托管的是上游 wheel，不是 Pyodide 自打包件
    lock_path = dest / "pyodide-lock.json"
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    for w in WHEELS:
        entry = lock["packages"].get(w["name"])
        if entry is None:
            raise SystemExit(f"{w['name']} missing from pyodide-lock.json")
        entry["sha256"] = w["sha256"]
    lock_path.write_text(
        json.dumps(lock, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    print("  patch pyodide-lock.json sha256 (upstream wheels)")

    total = sum(f.stat().st_size for f in dest.iterdir())
    print(f"done: {len(list(dest.iterdir()))} files, {total // (1 << 20)} MB -> {dest}")


if __name__ == "__main__":
    main()

#!/usr/bin/env bash
# 打包 LA Helper 桌面版为 macOS .app（PyInstaller）
# 用法：bash desktop/build_mac.sh
# 依赖：python + tkinter（本机已具备）+ pip install pyinstaller
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"   # 项目根目录
cd "$HERE"

echo "==> 项目根: $HERE"
python3 -m pip install -q --upgrade pyinstaller
echo "==> 开始打包 (PyInstaller, --windowed) ..."

python3 -m PyInstaller \
  --name "LA Helper" \
  --windowed \
  --noconfirm \
  --clean \
  --paths "$HERE" \
  --hidden-import core \
  --hidden-import core.engine \
  --hidden-import core.matrix \
  --hidden-import core.ops \
  --hidden-import core.inverse \
  --hidden-import core.lu \
  --hidden-import core.solve \
  --hidden-import core.det_rank \
  --hidden-import core.eigen \
  desktop/app.py

echo "==> 完成：dist/LA Helper.app"
echo "    双击即可运行（无需安装 Python，离线可用）。"

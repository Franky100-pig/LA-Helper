# 打包 LA Helper 桌面版为 Windows .exe（PyInstaller）
# 用法（PowerShell）：  .\desktop\build_win.ps1
# 依赖：Windows 上已装 Python 3.10+ 与 tkinter（标准库自带），然后 pip install pyinstaller
$ErrorActionPreference = "Stop"

$HERE = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $HERE

Write-Host "==> 项目根: $HERE"
python -m pip install -q --upgrade pyinstaller
Write-Host "==> 开始打包 (PyInstaller, --windowed) ..."

python -m PyInstaller `
  --name "LA Helper" `
  --windowed `
  --noconfirm `
  --clean `
  --paths $HERE `
  --hidden-import core `
  --hidden-import core.engine `
  --hidden-import core.matrix `
  --hidden-import core.ops `
  --hidden-import core.inverse `
  --hidden-import core.lu `
  --hidden-import core.solve `
  --hidden-import core.det_rank `
  --hidden-import core.eigen `
  (Join-Path "desktop" "app.py")

Write-Host "==> 完成：dist\LA Helper\LA Helper.exe"
Write-Host "    双击即可运行（无需安装 Python，离线可用）。"

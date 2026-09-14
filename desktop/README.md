# LA Helper · 桌面版（非网页）

原生桌面应用，复用 `core/` 的精确分数引擎（SymPy 后端）。**无需浏览器、无需联网、无需账号。**

## 直接运行（需本机有 Python + sympy）

```bash
cd <项目根目录>
pip install sympy
python desktop/app.py
```

## 打包成独立 App（别人无需装 Python）

### macOS（在本机一键生成 .app）
```bash
bash desktop/build_mac.sh
# 产物：dist/LA Helper.app  （双击即开，离线可用）
```

### Windows（在你的 Windows 机器上跑）
```powershell
.\desktop\build_win.ps1
# 产物：dist\LA Helper\LA Helper.exe
```
> 不能在 Mac 上交叉编译 Windows 版，需要在一台 Windows 上执行上面的脚本（Windows 的 Python 标准库自带 tkinter）。

## 功能
操作下拉框选择：乘法 / 加减 / 转置 / 标量乘 / 方阵求逆 / 左逆 / 右逆 / 伪逆 / LU 分解 / 增广求解 / RREF / 行列式 / 秩 / 特征值特征向量。

- 行列数：直接输入数字（1–16，默认 3×3），改完即时重绘网格。
- 输入：格子内填数字或分数（如 `1/3`），方向键 / 回车在格间移动（回车按行优先跳下一格）。
- 勾选「显示步骤」可看高斯消元 / LU 分解的逐步过程；勾「小数显示」把分数转成小数。
- 结果区用 `[ ]` 括号排版矩阵，便于对照。

## 说明
- 计算全部在本地完成，结果保持精确分数（如 `1/3` 不会变 `0.333`）。
- 桌面版与网页版（web/）、静态预览版（la-preview/）共用同一个 `core/` 引擎，结果一致。

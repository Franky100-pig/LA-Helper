# LA Helper · 线性代数本地学习计算器

一个 **100% 本地运行** 的开源小工具，帮你在学线性代数时"不仅算出结果，还能看懂过程"。
所有矩阵运算使用 SymPy **精确有理数**，所以 `1/3` 永远不会变成 `0.333`。

三个版本共用同一个 `core/` 引擎，结果完全一致，按你的使用场景挑一个就行：

| 版本 | 适合场景 | 怎么用 |
|---|---|---|
| 🖥 **桌面版** | 平时写作业，想双击就开 | 下载 [Releases](https://github.com/Franky100-pig/LA-Helper/releases) 里的安装包，免装 Python、免联网 |
| 🌐 **网页版** | 已经装着 Python，想改代码 | `python web/app.py`，自动开浏览器 |
| ☁️ **在线预览版** | 想在同学电脑 / 手机上演示 | 打开 <https://27f263035b214ac598c05e6f0dc76cff.app.workbuddy.host>，浏览器里跑真 Python |

## 功能
- 矩阵输入 / 展示、转置、加减、**标量乘**
- **矩阵乘法**（自动维度校验，输入上限 16×16）
- **方阵求逆**（Gauss-Jordan，带步骤）
- **左逆 / 右逆**（满列秩 / 满行秩时给出；不满秩时说明原因）
- **Moore-Penrose 伪逆**（通用）
- **LU 分解**（含部分主元，PA = LU，带步骤）
- **增广矩阵求解**（[A|b] → RREF，判定唯一解 / 无解 / 无穷多解 + 零空间基）
- **行列式、秩、RREF**
- **特征值 / 特征向量**（小矩阵精确；≥5×5 自动切数值解，避免 `CRootOf` 与长时间卡顿）
- 所有运算可**开关"显示步骤"**、可**切换小数显示**

---

## 🖥 桌面版（推荐日常用）

原生窗口程序，不开浏览器、不连网、不需要装 Python。

### 直接下载

到 [Releases](https://github.com/Franky100-pig/LA-Helper/releases) 页面下载对应你系统的压缩包：

| 你的系统 | 文件 | 首次打开 |
|---|---|---|
| macOS（Apple 芯片 / M 系列） | `LA-Helper-macOS-arm64.zip` | 解压后**右键 → 打开**（安装包未做签名，直接双击会被 Gatekeeper 拦） |
| Windows 10 / 11（64 位） | `LA-Helper-Windows-x64.zip` | 解压后双击 `LA Helper.exe`；SmartScreen 提示时点「更多信息 → 仍要运行」 |

> Intel 芯片的 Mac 用户请直接用下面的「从源码运行」，或自行执行 `bash desktop/build_mac.sh`。

### 从源码运行

```bash
pip install sympy
python desktop/app.py
```

### 自己打包

```bash
bash desktop/build_mac.sh      # macOS → dist/LA Helper.app
.\desktop\build_win.ps1        # Windows (PowerShell) → dist\LA Helper\LA Helper.exe
```

Windows 的 `.exe` **无法在 macOS 上交叉编译**，必须在一台 Windows 上执行脚本。
如果你没有 Windows 机器，直接推一个 `v*` 标签，本仓库的
[Release 流水线](.github/workflows/release.yml) 会在 GitHub 上自动构建两个平台的安装包。

---

## 🌐 网页版

```bash
pip install -r requirements.txt
python web/app.py        # 自动打开浏览器到 http://127.0.0.1:8000
```

无需联网、无需账号。可选参数：`--port 8123`、`--no-browser`、`--verbose`。
端口被占用时会自动顺延到下一个可用端口。

## 输入规则
单元格只接受**整数、小数、分数**（`1/3`、`-2`、`0.5`、`1e-3`）。
不认识的字符会直接报错提示，不会静默当变量处理，也不会执行任何表达式
（例如 `9**9**9` 这类会让服务卡死的输入会被拒绝）。

---

## 工程结构
```
la-helper/
├── core/          # 纯算法层（精确有理数，零 GUI / Web 依赖，全可单测）
├── web/           # 网页版：app.py 起服务 + index.html / app.js
├── desktop/       # 桌面版：tkinter GUI + 两个平台的打包脚本
├── tools/         # build_preview.py：把 core/ 打包成 Pyodide 静态预览
└── tests/         # pytest，TDD 红绿重构
```
- 算法与界面解耦：`core` 只算，`web` / `desktop` 只展示。
- 数值默认精确分数，勾选"小数显示"可切换为 4 位小数近似。

## 测试
```bash
pip install -r requirements-dev.txt
pytest
```
覆盖：core 各模块、`core.engine` 契约、以及输入安全 / 奇异矩阵 / 符号矩阵 / 大矩阵等回归用例。

## 安全边界
网页版只监听 `127.0.0.1`，不是面向公网的服务：不要把它暴露到局域网或反向代理之后。
桌面版与在线预览版全部计算在本地进程 / 浏览器沙箱内完成，不发送任何数据。

## 路线图
- [ ] 更多分解（QR / SVD）、Gram-Schmidt、最小二乘
- [ ] 步骤结构化（每步带矩阵快照与当前主元，支持单步播放 / 高亮）
- [ ] 矩阵粘贴导入 / 导出（文本与图片）
- [ ] RREF 可选"部分主元"策略，默认贴近课本演示

"""LA Helper — 本地桌面版（tkinter，零额外 GUI 依赖，Mac/Windows 通用）。

复用 core/engine.compute（精确分数，SymPy 后端）。无需浏览器、无需联网。
运行：  python desktop/app.py
打包： 见 desktop/build_mac.sh / build_win.ps1
"""
import os
import re
import sys
import tkinter as tk
from tkinter import ttk, scrolledtext

# 让 core 包可被导入：仓库根目录 = 本文件的上一级目录
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core import engine  # noqa: E402

OPS = [
    ("multiply", "矩阵乘法 A×B"),
    ("add", "加法 A+B"),
    ("sub", "减法 A−B"),
    ("transpose", "转置 Aᵀ"),
    ("scalar", "标量乘 k·A（k 填在 B 左上角）"),
    ("inverse", "方阵求逆 A⁻¹"),
    ("left_inverse", "左逆"),
    ("right_inverse", "右逆"),
    ("pseudo_inverse", "伪逆 A⁺"),
    ("lu", "LU 分解"),
    ("solve", "增广矩阵求解 Ax=b"),
    ("rref", "RREF 行最简形"),
    ("det", "行列式 det(A)"),
    ("rank", "秩 rank(A)"),
    ("eigen", "特征值 / 特征向量"),
]
OPS_NEED_B = {"multiply", "add", "sub", "solve", "scalar"}
MIN_DIM, MAX_DIM = 1, 16
FRACTION_RE = re.compile(r"^([+-]?\d+)/([+-]?\d+)$")


# --------------------------------------------------------------------------
# 数值格式化
# --------------------------------------------------------------------------
def fmt_cell(v, decimals):
    s = str(v)
    if decimals:
        m = FRACTION_RE.match(s)
        if m:
            den = int(m.group(2))
            if den != 0:
                s = str(int(m.group(1)) / den)
        num = float(s)
        if num.is_integer():
            s = str(int(num))
        else:
            s = f"{num:.4f}"
    return s


def format_matrix(mat, decimals=False):
    if not mat:
        return "[ ]"
    cells = [[fmt_cell(v, decimals) for v in row] for row in mat]
    widths = [max(len(c) for c in col) for col in zip(*cells)]
    lines = []
    for i, row in enumerate(cells):
        body = "  ".join(c.rjust(widths[j]) for j, c in enumerate(row))
        left = "[" if i == 0 else " "
        right = "]" if i == len(cells) - 1 else " "
        lines.append(left + body + right)
    return "\n".join(lines)


# --------------------------------------------------------------------------
# 主窗口
# --------------------------------------------------------------------------
class LAApp:
    def __init__(self, root):
        self.root = root
        self._style()
        root.title("LA Helper · 线性代数小算")
        try:
            root.iconbitmap(self._icon_path())
        except Exception:
            pass
        root.geometry("900x720")

        self.grids = {}
        self.dim_vars = {}
        self.matrix_outer = None
        self._rebuilding = False

        self._build_controls()
        self._build_matrices()
        self._build_result()

        self.refresh_b_panel()
        self.build_grid("A")
        self.build_grid("B")

    # ---- 主题 ----
    def _style(self):
        bg, panel, text, muted, accent = (
            "#0b0f14", "#151c25", "#e6edf3", "#8b98a5", "#4ea1ff")
        self.colors = dict(bg=bg, panel=panel, text=text, muted=muted, accent=accent)
        self.root.configure(bg=bg)
        try:
            self.root.tk_setPalette(
                background=bg, foreground=text,
                activeBackground=panel, activeForeground=text,
                selectColor=accent, selectBackground="#23303f",
                highlightBackground=bg, highlightColor=accent)
        except Exception:
            pass
        st = ttk.Style()
        st.theme_use("clam")
        st.configure("TFrame", background=bg)
        st.configure("TLabel", background=bg, foreground=text)
        st.configure("TCheckbutton", background=bg, foreground=text)
        st.configure("TCombobox", fieldbackground=panel, background=panel,
                     foreground=text, selectbackground=accent)
        st.configure("TSpinbox", fieldbackground=panel, background=panel,
                     foreground=text)
        st.configure("TButton", background=accent, foreground="#08121f",
                     font=("Helvetica", 12, "bold"))
        st.map("TButton", background=[("active", "#6fb4ff")])
        st.configure("TLabelframe", background=panel, foreground=accent)
        st.configure("TLabelframe.Label", background=panel, foreground=accent)

    def _icon_path(self):
        return os.path.join(ROOT, "desktop", "icon.icns")

    # ---- 顶部控制栏 ----
    def _build_controls(self):
        bar = ttk.Frame(self.root)
        bar.pack(fill="x", padx=12, pady=(12, 6))

        ttk.Label(bar, text="操作").pack(side="left", padx=(0, 4))
        self.op_var = tk.StringVar(value="multiply")
        op_names = [name for _, name in OPS]
        op_keys = [key for key, _ in OPS]
        self.op_cb = ttk.Combobox(bar, textvariable=self.op_var, values=op_names,
                                  state="readonly", width=30)
        self.op_cb.current(0)
        self.op_cb.pack(side="left", padx=(0, 12))
        # 把显示名映射回 key
        self.op_cb.bind("<<ComboboxSelected>>", lambda e: (self.refresh_b_panel()))

        self.steps_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(bar, text="显示步骤", variable=self.steps_var).pack(side="left", padx=6)
        self.dec_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(bar, text="小数显示", variable=self.dec_var).pack(side="left", padx=6)

        ttk.Button(bar, text="计算", command=self.compute).pack(side="right", padx=(12, 0))

    def _op_key(self):
        idx = self.op_cb.current()
        return OPS[idx][0]

    # ---- 矩阵输入区 ----
    def _build_matrices(self):
        outer = ttk.Frame(self.root)
        outer.pack(fill="x", padx=12, pady=6)
        self.matrix_outer = outer
        for prefix, label in (("A", "矩阵 A"), ("B", "矩阵 B / b")):
            panel = ttk.LabelFrame(outer, text=label)
            panel.pack(side="left", fill="both", expand=True, padx=6)
            dim = ttk.Frame(panel)
            dim.pack(fill="x", padx=8, pady=(6, 2))
            ttk.Label(dim, text="行").pack(side="left")
            rv = tk.IntVar(value=3)
            rs = ttk.Spinbox(dim, from_=MIN_DIM, to=MAX_DIM, width=4, textvariable=rv)
            rs.pack(side="left", padx=(2, 8))
            ttk.Label(dim, text="列").pack(side="left")
            cv = tk.IntVar(value=3)
            cs = ttk.Spinbox(dim, from_=MIN_DIM, to=MAX_DIM, width=4, textvariable=cv)
            cs.pack(side="left")
            rv.trace_add("write", lambda *a, p=prefix: self.build_grid(p))
            cv.trace_add("write", lambda *a, p=prefix: self.build_grid(p))
            self.dim_vars[prefix] = (rv, cv)

            grid = tk.Frame(panel, bg=self.colors["panel"])
            grid.pack(fill="both", expand=True, padx=8, pady=(2, 10))
            self.grids[prefix] = grid

    def clamp(self, v):
        try:
            n = int(v)
        except Exception:
            n = MIN_DIM
        return max(MIN_DIM, min(MAX_DIM, n))

    def _raw_grid(self, prefix):
        """(行, 列) -> 用户实际输入的原文，用于改尺寸时保留数据。

        直接按子控件的 grid 坐标取值，不依赖 dim_vars，这样即使行列刚被
        改成超范围值也读得对。
        """
        out = {}
        for ch in self.grids[prefix].winfo_children():
            info = ch.grid_info()
            out[(int(info["row"]), int(info["column"]))] = ch.get()
        return out

    def build_grid(self, prefix):
        rv, cv = self.dim_vars[prefix]
        rows, cols = self.clamp(rv.get()), self.clamp(cv.get())
        # 防止 Spinbox 的 trace_add("write") 在 rv.set/cv.set 时递归触发本函数
        if self._rebuilding:
            return
        self._rebuilding = True
        # 改行列时保留已填数据：旧网格内容先记下，重建后再按坐标填回去
        prev = self._raw_grid(prefix)
        rv.set(rows)
        cv.set(cols)
        grid = self.grids[prefix]
        for ch in grid.winfo_children():
            ch.destroy()
        grid.configure(width=cols * 70 + 10, height=rows * 46 + 10)
        for r in range(rows):
            for c in range(cols):
                e = tk.Entry(grid, width=8, justify="center",
                             bg="#0e1620", fg=self.colors["text"],
                             insertbackground=self.colors["accent"],
                             relief="solid", bd=1, highlightthickness=0)
                if (r, c) in prev:
                    e.insert(0, prev[(r, c)])
                e.grid(row=r, column=c, padx=3, pady=3, sticky="nsew")
                e.bind("<KeyPress>", lambda ev, p=prefix, rr=r, cc=c: self._nav(ev, p, rr, cc))
        grid.grid_propagate(False)
        self._rebuilding = False

    def _nav(self, ev, prefix, r, c):
        grid = self.grids[prefix]
        rows, cols = self.clamp(self.dim_vars[prefix][0].get()), self.clamp(self.dim_vars[prefix][1].get())
        nr, nc = r, c
        k = ev.keysym
        if k == "Right":
            nc += 1
        elif k == "Left":
            nc -= 1
        elif k == "Down":
            nr += 1
        elif k == "Up":
            nr -= 1
        elif k == "Return":
            # 行优先：到行末折到下一行首格
            nc += 1
            if nc >= cols:
                nc = 0
                nr += 1
        else:
            return
        if nr >= rows:
            nr = 0
        if nr < 0:
            nr = rows - 1
        if nc >= cols:
            nc = 0
        if nc < 0:
            nc = cols - 1
        target = grid.grid_slaves(row=nr, column=nc)
        if target:
            target[0].focus_set()
            return "break"

    def read_matrix(self, prefix):
        grid = self.grids[prefix]
        rows, cols = self.clamp(self.dim_vars[prefix][0].get()), self.clamp(self.dim_vars[prefix][1].get())
        data = []
        for r in range(rows):
            row = []
            for c in range(cols):
                slaves = grid.grid_slaves(row=r, column=c)
                val = slaves[0].get().strip() if slaves else ""
                row.append(val if val != "" else "0")
            data.append(row)
        return data

    def refresh_b_panel(self):
        # 显示/隐藏 B 面板（B 的 LabelFrame 是 matrix_outer 的子控件）
        b_panel = self.grids["B"].master
        if self._op_key() in OPS_NEED_B:
            self.matrix_outer.pack(fill="x", padx=12, pady=6)
            b_panel.pack(side="left", fill="both", expand=True, padx=6)
        else:
            b_panel.pack_forget()

    # ---- 结果区 ----
    def _build_result(self):
        rf = ttk.LabelFrame(self.root, text="结果")
        rf.pack(fill="both", expand=True, padx=12, pady=(6, 12))
        self.out = scrolledtext.ScrolledText(
            rf, bg="#0e1620", fg=self.colors["text"],
            insertbackground=self.colors["accent"],
            font=("Menlo", 13), wrap="word", relief="flat", bd=0)
        self.out.pack(fill="both", expand=True, padx=10, pady=10)
        self.out.tag_configure("title", foreground=self.colors["accent"],
                               font=("Menlo", 15, "bold"))
        self.out.tag_configure("sub", foreground=self.colors["muted"],
                               font=("Menlo", 12, "bold"))
        self.out.tag_configure("warn", foreground="#ffb454",
                               font=("Menlo", 13, "bold"))
        self.out.tag_configure("err", foreground="#ff6b6b",
                               font=("Menlo", 13, "bold"))
        self.out.tag_configure("mat", foreground=self.colors["text"],
                               font=("Menlo", 14))
        self.out.config(state="disabled")

    def _write(self, text, tag=None):
        self.out.config(state="normal")
        self.out.insert("end", text + "\n", tag)
        self.out.config(state="disabled")

    def render_result(self, res):
        self.out.config(state="normal")
        self.out.delete("1.0", "end")
        dec = self.dec_var.get()
        if not res.get("ok"):
            self._write("⚠️ " + str(res.get("error", "未知错误")), "err")
            self.out.config(state="disabled")
            return
        t = res.get("type")
        if t == "matrix":
            self._write("结果", "title")
            self._write(format_matrix(res["data"], dec), "mat")
        elif t == "scalar":
            self._write("结果", "title")
            self._write(fmt_cell(res["value"], dec), "mat")
        elif t == "lu":
            self._write("LU 分解   P·A = L·U", "title")
            self._write("P（置换）", "sub")
            self._write(format_matrix(res["P"], dec), "mat")
            self._write("L（单位下三角）", "sub")
            self._write(format_matrix(res["L"], dec), "mat")
            self._write("U（上三角）", "sub")
            self._write(format_matrix(res["U"], dec), "mat")
        elif t == "solve":
            badge = {"unique": "唯一解", "none": "无解", "infinite": "无穷多解"}.get(res["status"], res["status"])
            self._write(f"求解结果：{badge}", "title")
            if res["status"] != "none" and res.get("particular"):
                self._write("特解 x*", "sub")
                self._write(format_matrix(res["particular"], dec), "mat")
            if res.get("null_basis"):
                free = ", ".join("x" + str(i + 1) for i in res["free_vars"])
                self._write(f"零空间基（自由变量：{free}）", "sub")
                for v in res["null_basis"]:
                    self._write(format_matrix(v, dec), "mat")
        elif t == "inverse_status":
            self._write("不存在：" + str(res.get("note", "")), "warn")
        elif t == "eigen":
            self._write("特征值 / 特征向量", "title")
            for p in res["pairs"]:
                lam = fmt_cell(p["value"], dec)
                line = f"λ = {lam}  （代数重数 {p['multiplicity']}"
                if p.get("geometric") is not None and p["geometric"] < p["multiplicity"]:
                    line += f"，几何重数 {p['geometric']} → 不可对角化"
                line += "）"
                self._write(line, "sub")
                if p.get("approx") and p.get("exact") and p["exact"] != p["value"]:
                    self._write("精确值：" + str(p["exact"]), "mat")
                for v in p["vectors"]:
                    self._write(format_matrix(v, dec), "mat")
        if res.get("steps"):
            self._write("计算步骤", "title")
            for i, s in enumerate(res["steps"], 1):
                self._write(f"{i}. {s}", "mat")
        self.out.config(state="disabled")

    # ---- 计算 ----
    def compute(self):
        op = self._op_key()
        payload = {"op": op, "A": self.read_matrix("A"),
                   "show_steps": self.steps_var.get()}
        if op in OPS_NEED_B:
            payload["B"] = self.read_matrix("B")
        try:
            res = engine.compute(op, payload["A"],
                                 payload.get("B"), payload["show_steps"])
        except Exception as e:
            res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self.render_result(res)


def main():
    root = tk.Tk()
    LAApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()

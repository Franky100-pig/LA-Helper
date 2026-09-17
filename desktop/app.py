"""LA Helper — 本地桌面版（tkinter，零额外 GUI 依赖，Mac/Windows 通用）。

复用 core/engine.dispatch（精确分数，SymPy 后端）。无需浏览器、无需联网。
复用 desktop/model.LibraryModel：命名矩阵库（网页同款能力）。

两条计算路径共用一个后端入口 engine.dispatch：
  - 下拉框路径：选操作 + 两个库内矩阵作为操作数
  - 表达式路径：在表达式框里写 A + B / inv(A) / 2*A，针对整个矩阵库求值
两者结果保证一致（表达式最终也回落到 engine.compute）。

运行：  python desktop/app.py
打包： 见 desktop/build_mac.sh / build_win.ps1
"""
import os
import sys
import tkinter as tk
import tkinter.font as tkFont
from tkinter import ttk, scrolledtext, simpledialog, messagebox

# 让 core / desktop 包可被导入：仓库根目录 = 本文件的上两级目录
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core import engine                          # noqa: E402
from desktop.model import (                       # noqa: E402
    LibraryModel, MIN_DIM, MAX_DIM, NAME_RE, format_matrix, clamp_dim, FRACTION_RE,
)

OPS = [
    ("multiply", "矩阵乘法 A×B"),
    ("add", "加法 A+B"),
    ("sub", "减法 A−B"),
    ("transpose", "转置 Aᵀ"),
    ("scalar", "标量乘 k·A（k 填在右侧矩阵里）"),
    ("inverse", "方阵求逆 A⁻¹"),
    ("left_inverse", "左逆"),
    ("right_inverse", "右逆"),
    ("pseudo_inverse", "伪逆 A⁺"),
    ("lu", "LU 分解"),
    ("solve", "增广矩阵求解 Ax=b"),
    ("ref", "REF 行阶梯形"),
    ("det", "行列式 det(A)"),
    ("rank", "秩 rank(A)"),
    ("eigen", "特征值 / 特征向量"),
]
OPS_NEED_B = {"multiply", "add", "sub", "solve", "scalar"}


# 结果区默认最小行数（比原先更高）；内容超过视口时整窗滚动，结果框本身不内滚
MIN_RESULT_LINES = 20
MAX_RESULT_LINES = 200


class ScrollableFrame(ttk.Frame):
    """整窗可滚动容器：内容超过视口时，整个页面（而非结果框）上下滚动。"""
    def __init__(self, parent, bg, **kw):
        super().__init__(parent, **kw)
        self.canvas = tk.Canvas(self, bg=bg, highlightthickness=0)
        self.vsb = ttk.Scrollbar(self, orient="vertical", command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.vsb.set)
        self.canvas.pack(side="left", fill="both", expand=True)
        self.vsb.pack(side="right", fill="y")
        self.inner = ttk.Frame(self.canvas)
        self._win = self.canvas.create_window((0, 0), window=self.inner, anchor="nw")
        self.inner.bind("<Configure>",
                        lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all")))
        self.canvas.bind("<Configure>", self._on_canvas_configure)
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)

    def _on_canvas_configure(self, event):
        self.canvas.itemconfig(self._win, width=event.width)

    def _on_mousewheel(self, event):
        if sys.platform == "darwin":
            self.canvas.yview_scroll(-event.delta, "units")
        else:
            self.canvas.yview_scroll(int(-event.delta / 120), "units")


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
        root.geometry("960x780")
        root.minsize(720, 560)

        # 整窗可滚动容器：结果区不再内滚，超出的内容由整窗滚动查看
        self.scroll = ScrollableFrame(root, bg=self.colors["bg"])
        self.scroll.pack(fill="both", expand=True)
        self.inner = self.scroll.inner

        self.model = LibraryModel()
        self.grids = {}          # name -> editor grid (only the editing one is live)
        self.edit_widgets = []   # (r, c, Entry) for the editing matrix
        self._rebuilding = False

        self._build_controls()
        self._build_library()
        self._build_expression()
        self._build_result()

        self.refresh_all()

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
        st.configure("TNotebook", background=bg)
        st.configure("TNotebook.Tab", background=panel, foreground=text)

    def _icon_path(self):
        return os.path.join(ROOT, "desktop", "icon.icns")

    # ---- 顶部控制栏（下拉框路径）-------------------------------------------
    def _build_controls(self):
        bar = ttk.Frame(self.inner)
        bar.pack(fill="x", padx=12, pady=(12, 6))

        ttk.Label(bar, text="操作").pack(side="left", padx=(0, 4))
        self.op_var = tk.StringVar(value="multiply")
        op_names = [name for _, name in OPS]
        self.op_cb = ttk.Combobox(bar, textvariable=self.op_var, values=op_names,
                                  state="readonly", width=30)
        self.op_cb.current(0)
        self.op_cb.pack(side="left", padx=(0, 10))
        self.op_cb.bind("<<ComboboxSelected>>", lambda e: self.refresh_operand_options())

        ttk.Label(bar, text="左").pack(side="left", padx=(0, 2))
        self.left_var = tk.StringVar()
        self.left_cb = ttk.Combobox(bar, textvariable=self.left_var, state="readonly",
                                    width=6)
        self.left_cb.pack(side="left", padx=(0, 8))

        ttk.Label(bar, text="右").pack(side="left", padx=(0, 2))
        self.right_var = tk.StringVar()
        self.right_cb = ttk.Combobox(bar, textvariable=self.right_var, state="readonly",
                                     width=6)
        self.right_cb.pack(side="left", padx=(0, 10))

        self.steps_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(bar, text="显示步骤", variable=self.steps_var).pack(side="left", padx=6)
        self.dec_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(bar, text="小数显示", variable=self.dec_var).pack(side="left", padx=6)

        ttk.Button(bar, text="计算", command=self.compute_dropdown).pack(side="right", padx=(12, 0))

    def _op_key(self):
        idx = self.op_cb.current()
        return OPS[idx][0]

    def refresh_operand_options(self):
        names = self.model.names()
        for sel, var in ((self.left_cb, self.left_var), (self.right_cb, self.right_var)):
            sel["values"] = names
        if self.left_var.get() not in names:
            self.left_var.set(names[0] if names else "")
        if self.right_var.get() not in names:
            self.right_var.set(names[1] if len(names) > 1 else (names[0] if names else ""))
        if self._op_key() in OPS_NEED_B:
            self.right_cb.pack(side="left", padx=(0, 10))
            self.right_cb.lift(self.left_cb)
        else:
            self.right_cb.pack_forget()

    # ---- 矩阵库 --------------------------------------------------------------
    def _build_library(self):
        outer = ttk.LabelFrame(self.inner, text="矩阵库（命名矩阵）")
        outer.pack(fill="x", padx=12, pady=6)
        self.lib_outer = outer

        chips = ttk.Frame(outer)
        chips.pack(fill="x", padx=8, pady=(6, 2))
        self.chips_frame = chips
        ttk.Button(chips, text="＋ 新增", width=8, command=self.add_matrix).pack(side="left", padx=4)
        ttk.Button(chips, text="✎ 改名", width=8, command=self.rename_matrix).pack(side="left", padx=4)
        ttk.Button(chips, text="🗑 删除", width=8, command=self.delete_matrix).pack(side="left", padx=4)
        ttk.Button(chips, text="清空", width=8, command=self.clear_matrix).pack(side="left", padx=4)

        editor = ttk.Frame(outer)
        editor.pack(fill="x", padx=8, pady=(2, 8))
        self.edit_name_var = tk.StringVar()
        ttk.Label(editor, text="正在编辑：").pack(side="left")
        ttk.Label(editor, textvariable=self.edit_name_var, foreground=self.colors["accent"],
                  font=("Helvetica", 12, "bold")).pack(side="left", padx=(0, 12))

        ttk.Label(editor, text="行").pack(side="left")
        self.rv = tk.IntVar(value=3)
        rs = ttk.Spinbox(editor, from_=MIN_DIM, to=MAX_DIM, width=4, textvariable=self.rv)
        rs.pack(side="left", padx=(2, 8))
        ttk.Label(editor, text="列").pack(side="left")
        self.cv = tk.IntVar(value=3)
        cs = ttk.Spinbox(editor, from_=MIN_DIM, to=MAX_DIM, width=4, textvariable=self.cv)
        cs.pack(side="left", padx=(0, 10))
        self.rv.trace_add("write", lambda *a: self.on_dim_change())
        self.cv.trace_add("write", lambda *a: self.on_dim_change())

        ttk.Button(editor, text="从剪贴板粘贴", command=self.paste_from_clipboard).pack(side="right", padx=4)

        self.edit_grid = tk.Frame(outer, bg=self.colors["panel"])
        self.edit_grid.pack(fill="x", padx=8, pady=(2, 4))

        prev = ttk.LabelFrame(outer, text="预览（引擎实际读取，空格补 0）")
        prev.pack(fill="x", padx=8, pady=(2, 8))
        self.preview = scrolledtext.ScrolledText(
            prev, bg="#0e1620", fg=self.colors["text"],
            insertbackground=self.colors["accent"],
            font=("Menlo", 13), wrap="none", relief="flat", bd=0, height=6)
        self.preview.pack(fill="x", padx=8, pady=6)
        self.preview.config(state="disabled")

    def refresh_chips(self):
        # 重建 chips（保留前 4 个功能按钮，其余是矩阵名按钮）
        for w in list(self.chips_frame.children.values()):
            if isinstance(w, ttk.Button) and w.cget("text") in ("＋ 新增", "✎ 改名", "🗑 删除", "清空"):
                continue
            w.destroy()
        for name in self.model.names():
            b = ttk.Button(self.chips_frame, text=name, width=5,
                           command=lambda n=name: self.select_matrix(n))
            if name == self.model.editing:
                b.configure(text=f"●{name}")
            b.pack(side="left", padx=4)

    def select_matrix(self, name):
        self.model.editing = name
        self.rv.set(self.model.current()["rows"])
        self.cv.set(self.model.current()["cols"])
        self.build_edit_grid()
        self.refresh_chips()
        self.render_preview()

    def build_edit_grid(self):
        m = self.model.current()
        rows, cols = m["rows"], m["cols"]
        if self._rebuilding:
            return
        self._rebuilding = True
        for ch in self.edit_grid.winfo_children():
            ch.destroy()
        self.edit_widgets = []
        self.edit_grid.configure(width=cols * 70 + 10, height=rows * 46 + 10)
        for r in range(rows):
            for c in range(cols):
                e = tk.Entry(self.edit_grid, width=8, justify="center",
                             bg="#0e1620", fg=self.colors["text"],
                             insertbackground=self.colors["accent"],
                             relief="solid", bd=1, highlightthickness=0)
                e.insert(0, m["cells"][r][c])
                e.grid(row=r, column=c, padx=3, pady=3, sticky="nsew")
                e.bind("<KeyPress>", lambda ev, rr=r, cc=c: self._nav(ev, rr, cc))
                e.bind("<FocusIn>", lambda ev, rr=r, cc=c: self._store_prev(ev, rr, cc))
                self.edit_widgets.append((r, c, e))
        self.edit_grid.grid_propagate(False)
        self._rebuilding = False

    def _store_prev(self, ev, r, c):
        ev.widget.delete(0, "end")
        ev.widget.insert(0, self.model.current()["cells"][r][c])

    def _nav(self, ev, r, c):
        m = self.model.current()
        rows, cols = m["rows"], m["cols"]
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
        for (tr, tc, w) in self.edit_widgets:
            if tr == nr and tc == nc:
                w.focus_set()
                return "break"

    def on_cell_commit(self, r, c, value):
        self.model.set_cell(self.model.editing, r, c, value)
        self.render_preview()

    def on_dim_change(self):
        if self._rebuilding:
            return
        rows = clamp_dim(self.rv.get())
        cols = clamp_dim(self.cv.get())
        self.rv.set(rows)
        self.cv.set(cols)
        self.model.resize(self.model.editing, rows, cols)
        self.build_edit_grid()
        self.render_preview()
        self.set_msg("")

    def render_preview(self):
        m = self.model.current()
        text = format_matrix(self.model.data_of(self.model.editing),
                             self.dec_var.get())
        self.preview.config(state="normal")
        self.preview.delete("1.0", "end")
        self.preview.insert("end", text)
        self.preview.config(state="disabled")

    # ---- 库操作 ----
    def add_matrix(self):
        name = self.model.add()
        self.rv.set(3)
        self.cv.set(3)
        self.build_edit_grid()
        self.refresh_chips()
        self.refresh_operand_options()
        self.render_preview()
        self.set_msg(f"已新增 {name}")

    def delete_matrix(self):
        try:
            old = self.model.editing
            self.model.delete(old)
        except ValueError as e:
            messagebox.showwarning("提示", str(e))
            return
        self.rv.set(self.model.current()["rows"])
        self.cv.set(self.model.current()["cols"])
        self.build_edit_grid()
        self.refresh_chips()
        self.refresh_operand_options()
        self.render_preview()
        self.set_msg(f"已删除 {old}")

    def clear_matrix(self):
        self.model.clear(self.model.editing)
        self.build_edit_grid()
        self.render_preview()
        self.set_msg(f"已清空 {self.model.editing}")

    def rename_matrix(self):
        old = self.model.editing
        new = simpledialog.askstring("改名", f"将 {old} 改名为：",
                                     initialvalue=old, parent=self.root)
        if not new:
            return
        try:
            self.model.rename(old, new)
        except ValueError as e:
            messagebox.showerror("名称无效", str(e))
            return
        self.edit_name_var.set(new)
        self.refresh_chips()
        self.refresh_operand_options()
        self.set_msg(f"已改名为 {new}")

    def paste_from_clipboard(self):
        try:
            text = self.root.clipboard_get()
        except Exception:
            self.set_msg("剪贴板为空或无法读取", warn=True)
            return
        if not text or not text.strip():
            self.set_msg("剪贴板里没有内容", warn=True)
            return
        nums = _numbers_in(text)
        if not nums:
            self.set_msg("剪贴板里没找到数字", warn=True)
            return
        # 多行且每行数字个数一致 -> 采用这个形状
        structured = _row_structure(text)
        if structured:
            rows = min(MAX_DIM, structured["rows"])
            cols = min(MAX_DIM, structured["cols"])
        else:
            n = len(nums)
            side = int(n ** 0.5)
            if side * side == n and side <= MAX_DIM:
                rows = cols = side
            else:
                rows = min(MAX_DIM, self.model.current()["rows"])
                cols = min(MAX_DIM, (n + rows - 1) // rows) if n % rows == 0 else min(MAX_DIM, n)
                if n > rows * cols:
                    cols = min(MAX_DIM, n // rows + (1 if n % rows else 0))
        self.model.resize(self.model.editing, rows, cols)
        values = nums[: rows * cols]
        for i, v in enumerate(values):
            r, c = divmod(i, cols)
            self.model.set_cell(self.model.editing, r, c, v)
        self.rv.set(rows)
        self.cv.set(cols)
        self.build_edit_grid()
        self.render_preview()
        self.set_msg(f"已识别为 {rows}×{cols}，共 {len(values)} 个数")

    def set_msg(self, text, warn=False):
        # 轻量反馈：写到预览上方的编辑名旁边不方便，这里复用窗口标题提示
        if text:
            self.root.title("LA Helper · " + text)
        else:
            self.root.title("LA Helper · 线性代数小算")

    # ---- 表达式路径 ----------------------------------------------------------
    def _build_expression(self):
        f = ttk.LabelFrame(self.inner, text="表达式（快捷键，针对整个矩阵库求值）")
        f.pack(fill="x", padx=12, pady=6)
        self.expr_var = tk.StringVar()
        entry = ttk.Entry(f, textvariable=self.expr_var, font=("Menlo", 13))
        entry.pack(side="left", fill="x", expand=True, padx=8, pady=8)
        entry.bind("<Return>", lambda e: self.compute_expr())
        ttk.Button(f, text="计算表达式", command=self.compute_expr).pack(side="right", padx=8, pady=8)
        self.expr_hint = ttk.Label(f, text="")
        self.expr_hint.pack(side="left", padx=8)
        self.expr_entry = entry

    def refresh_all(self):
        self.refresh_operand_options()
        self.refresh_chips()
        self.edit_name_var.set(self.model.editing)
        self.rv.set(self.model.current()["rows"])
        self.cv.set(self.model.current()["cols"])
        self.build_edit_grid()
        self.render_preview()
        self.update_expr_hint()

    def update_expr_hint(self):
        self.expr_hint.config(text="可用矩阵：" + "、".join(self.model.names()))

    # ---- 结果区 --------------------------------------------------------------
    def _build_result(self):
        rf = ttk.LabelFrame(self.inner, text="结果")
        rf.pack(fill="x", expand=False, padx=12, pady=(6, 12))
        # 结果框不内滚：高度按内容自适应（无内部滚动条），超出部分由整窗滚动
        self.out = tk.Text(
            rf, bg="#0e1620", fg=self.colors["text"],
            insertbackground=self.colors["accent"],
            font=("Menlo", 13), wrap="word", relief="flat", bd=0,
            height=MIN_RESULT_LINES, state="disabled")
        self.out.pack(fill="x", expand=False, anchor="n", padx=10, pady=10)
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
            self._write(self._fmt_scalar(res["value"], dec), "mat")
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
                lam = self._fmt_scalar(p["value"], dec)
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
        self._fit_result_height()

    def _fit_result_height(self):
        """让结果框高度恰好容纳全部内容（不出现内部滚动条）。"""
        try:
            self.out.update_idletasks()
            avail = self.out.winfo_width() - 16
            if avail < 80:
                avail = 760  # 未布局时退回保守值（偏窄→行数偏多→更安全）
            font = tkFont.Font(font=self.out.cget("font"))
            text = self.out.get("1.0", "end-1c")
            total = 0
            for ln in text.split("\n"):
                w = font.measure(ln)
                total += max(1, -(-w // avail))
            total = max(MIN_RESULT_LINES, min(MAX_RESULT_LINES, total + 1))
            self.out.configure(height=total)
        except Exception:
            pass

    def _fmt_scalar(self, v, dec):
        s = str(v)
        if dec:
            from desktop.model import FRACTION_RE
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

    # ---- 计算 ----
    def compute_dropdown(self):
        op = self._op_key()
        show_steps = self.steps_var.get()
        payload = {"op": op, "A": self.model.data_of(self.left_var.get()),
                   "showSteps": show_steps}
        if op in OPS_NEED_B:
            payload["B"] = self.model.data_of(self.right_var.get())
        try:
            res = engine.dispatch(payload)
        except Exception as e:
            res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self.render_result(res)

    def compute_expr(self):
        text = self.expr_var.get().strip()
        if not text:
            self.expr_entry.focus_set()
            return
        payload = {"expr": text, "matrices": self.model.matrix_data(),
                   "showSteps": self.steps_var.get()}
        try:
            res = engine.dispatch(payload)
        except Exception as e:
            res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        self.render_result(res)


# --------------------------------------------------------------------------
# 剪贴板解析辅助（与网页同款逻辑）
# --------------------------------------------------------------------------
import re  # noqa: E402

_NUM_RE = re.compile(r"[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?")
_WS_RE = re.compile(r"\s+")


def _numbers_in(text):
    return _NUM_RE.findall(text)


def _row_structure(text):
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if len(lines) < 2:
        return None
    counts = [_numbers_in(ln) for ln in lines]
    if any(len(c) == 0 for c in counts):
        return None
    if len(set(map(len, counts))) != 1:
        return None
    return {"rows": len(lines), "cols": len(counts[0])}


def main():
    root = tk.Tk()
    LAApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()

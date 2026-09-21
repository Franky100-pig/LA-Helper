"""LA Helper — 本地桌面版（tkinter，零额外 GUI 依赖，Mac/Windows 通用）。

复用 core/engine.dispatch（精确分数，SymPy 后端）。无需浏览器；计算不联网
（只有可选的「检查新版本」会访问 GitHub Releases）。
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
import threading
import time
import webbrowser
import tkinter as tk
import tkinter.font as tkFont
from tkinter import ttk, scrolledtext, simpledialog, messagebox, filedialog

# 让 core / desktop 包可被导入：仓库根目录 = 本文件的上两级目录
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from core import engine, photo, format_math      # noqa: E402
from core import __version__ as APP_VERSION      # noqa: E402
from desktop import update as update_mod         # noqa: E402
from desktop.model import (                       # noqa: E402
    LibraryModel, MIN_DIM, MAX_DIM, format_matrix, clamp_dim,
)

# ---- 本地设置（API key 等，仅存于本机，绝不入库）----
import json as _json
CONFIG_PATH = os.path.expanduser("~/.la_helper_settings.json")


def load_settings():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as _f:
            return _json.load(_f)
    except Exception:
        return {}


def save_settings(d):
    """Persist settings. The file holds the API key, so keep it owner-only."""
    try:
        # Create with 0600 in one step, so there is never a window where the
        # key sits in a world-readable file.
        fd = os.open(CONFIG_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as _f:
            _json.dump(d, _f)
        try:
            os.chmod(CONFIG_PATH, 0o600)   # tighten a pre-existing file too
        except OSError:
            pass
    except Exception:
        pass


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
# 行列式有两种算法：下拉框里仍是同一项「行列式 det(A)」，旁边的小下拉切换算法。
DET_METHODS = ["行变换法（推荐）", "代数余子式展开"]
DET_METHOD_OPS = {"行变换法（推荐）": "det", "代数余子式展开": "det_cofactor"}


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

        # 启动后稍等再在后台线程里查一次新版本（不阻塞界面、失败静默）
        self.root.after(1500, self._maybe_check_updates)

    # ---- 检查更新 ----------------------------------------------------------
    AUTO_CHECK_INTERVAL = 24 * 3600   # 自动检查的最小间隔（秒），避免每次启动都发请求

    def _maybe_check_updates(self, force=False):
        """查 GitHub 最新版本。启动时静默检查；force=True 是用户手动点。"""
        s = load_settings()
        if not force:
            if not s.get("check_updates", True):
                return
            try:
                last = float(s.get("last_update_check") or 0)
            except (TypeError, ValueError):
                last = 0
            if time.time() - last < self.AUTO_CHECK_INTERVAL:
                return
        threading.Thread(target=self._update_worker, args=(force,), daemon=True).start()

    def _update_worker(self, force):
        # 网络请求放在子线程，避免卡住界面
        res = update_mod.check_for_update(APP_VERSION)
        s = load_settings()
        s["last_update_check"] = time.time()
        save_settings(s)
        try:
            # 弹窗必须在主线程：用 after 把结果交回去
            self.root.after(0, lambda: self._on_update_result(res, force))
        except Exception:
            pass

    def _on_update_result(self, res, force):
        status = res.get("status")
        if status == update_mod.NEW:
            if messagebox.askyesno(
                    "发现新版本",
                    "检测到新版本 %s（当前 %s）。\n\n是否打开下载页面？"
                    % (res.get("tag"), APP_VERSION)):
                webbrowser.open(res.get("url") or update_mod.RELEASES_PAGE)
        elif force and status == update_mod.LATEST:
            messagebox.showinfo("检查更新", "已是最新版本（%s）。" % APP_VERSION)
        elif force and status == update_mod.ERROR:
            messagebox.showwarning("检查更新", "检查失败，请确认网络连接后重试。")

    # ---- 主题（深色 + 纯白底浅色两套配色）----
    def _style(self):
        self._palettes = {
            "dark": dict(
                bg="#1e262e", panel="#28323c", text="#d6dce2", muted="#9aa6b2",
                accent="#7aa7d6", accent_hover="#6fb4ff", field="#26303a",
                btn_fg="#1b2530", select="#23303f", warn="#ffb454", err="#ff6b6b"),
            "light": dict(
                bg="#ffffff", panel="#ffffff", text="#1f2328", muted="#5f6b76",
                accent="#2f74b5", accent_hover="#4a90d9", field="#f6f8fa",
                btn_fg="#ffffff", select="#cfe0f0", warn="#a8621c", err="#c0392b"),
        }
        self.apply_theme(load_settings().get("theme", "dark"))

    def apply_theme(self, theme):
        """切换主题：重设配色 + ttk 样式，并把已创建的 tk 控件也刷新一遍。"""
        if theme not in self._palettes:
            theme = "dark"
        self.theme = theme
        c = self.colors = self._palettes[theme]
        root = self.root
        root.configure(bg=c["bg"])
        try:
            root.tk_setPalette(
                background=c["bg"], foreground=c["text"],
                activeBackground=c["panel"], activeForeground=c["text"],
                selectColor=c["accent"], selectBackground=c["select"],
                highlightBackground=c["bg"], highlightColor=c["accent"])
        except Exception:
            pass
        st = ttk.Style()
        st.theme_use("clam")
        st.configure("TFrame", background=c["bg"])
        st.configure("TLabel", background=c["bg"], foreground=c["text"])
        st.configure("TCheckbutton", background=c["bg"], foreground=c["text"])
        st.configure("TCombobox", fieldbackground=c["panel"], background=c["panel"],
                     foreground=c["text"], selectbackground=c["accent"])
        st.configure("TSpinbox", fieldbackground=c["panel"], background=c["panel"],
                     foreground=c["text"])
        st.configure("TButton", background=c["accent"], foreground=c["btn_fg"],
                     font=("Helvetica", 12, "bold"))
        st.map("TButton", background=[("active", c["accent_hover"])])
        st.configure("TLabelframe", background=c["panel"], foreground=c["accent"])
        st.configure("TLabelframe.Label", background=c["panel"], foreground=c["accent"])
        st.configure("TNotebook", background=c["bg"])
        st.configure("TNotebook.Tab", background=c["panel"], foreground=c["text"])
        self._refresh_widget_colors()
        self._sync_theme_btn()

    def _refresh_widget_colors(self):
        """把那些用 tk（非 ttk）建、颜色写死的控件也刷成新配色。"""
        c = self.colors
        for w in (getattr(self, "preview", None), getattr(self, "out", None)):
            try:
                w.configure(bg=c["field"], fg=c["text"], insertbackground=c["accent"])
            except Exception:
                pass
        for _r, _c, entry in getattr(self, "edit_widgets", []):
            try:
                entry.configure(bg=c["field"], fg=c["text"], insertbackground=c["accent"])
            except Exception:
                pass
        for attr, key in (("scroll", "bg"), ("edit_grid", "panel")):
            w = getattr(self, attr, None)
            if w is not None:
                target = getattr(w, "canvas", w)   # ScrollableFrame -> 内层 canvas
                try:
                    target.configure(bg=c[key])
                except Exception:
                    pass
        out = getattr(self, "out", None)
        if out is not None:
            out.tag_configure("title", foreground=c["accent"], font=("Menlo", 15, "bold"))
            out.tag_configure("sub", foreground=c["muted"], font=("Menlo", 12, "bold"))
            out.tag_configure("warn", foreground=c["warn"], font=("Menlo", 13, "bold"))
            out.tag_configure("err", foreground=c["err"], font=("Menlo", 13, "bold"))
            out.tag_configure("mat", foreground=c["text"], font=("Menlo", 14))

    def _sync_theme_btn(self):
        """按钮文字显示「点了会切到」的模式（深色时显示浅色）。"""
        v = getattr(self, "theme_btn_var", None)
        if v is not None:
            v.set("浅色" if self.theme == "dark" else "深色")

    def toggle_theme(self):
        self.apply_theme("light" if self.theme == "dark" else "dark")
        s = load_settings()
        s["theme"] = self.theme
        save_settings(s)

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

        self._left_lbl = ttk.Label(bar, text="左")
        self._left_lbl.pack(side="left", padx=(0, 2))
        self.left_var = tk.StringVar()
        self.left_cb = ttk.Combobox(bar, textvariable=self.left_var, state="readonly",
                                    width=6)
        self.left_cb.pack(side="left", padx=(0, 8))

        # det 算法下拉：默认隐藏，选了「行列式」才插到「左」标签前面
        self.det_method_var = tk.StringVar(value=DET_METHODS[0])
        self.det_method_cb = ttk.Combobox(
            bar, textvariable=self.det_method_var, state="readonly", width=16,
            values=DET_METHODS)
        self._det_cb_shown = False

        ttk.Label(bar, text="右").pack(side="left", padx=(0, 2))
        self.right_var = tk.StringVar()
        self.right_cb = ttk.Combobox(bar, textvariable=self.right_var, state="readonly",
                                     width=6)
        self.right_cb.pack(side="left", padx=(0, 10))

        self.steps_var = tk.BooleanVar(value=True)
        ttk.Checkbutton(bar, text="显示步骤", variable=self.steps_var).pack(side="left", padx=6)
        self.dec_var = tk.BooleanVar(value=False)
        ttk.Checkbutton(bar, text="小数显示", variable=self.dec_var).pack(side="left", padx=6)

        ttk.Button(bar, text="设置", command=self.open_settings).pack(side="right", padx=(8, 0))
        ttk.Button(bar, text="计算", command=self.compute_dropdown).pack(side="right", padx=(12, 0))
        # 深 / 浅色切换：文字显示「点了会切到」的模式
        self.theme_btn_var = tk.StringVar(
            value="浅色" if self.theme == "dark" else "深色")
        ttk.Button(bar, textvariable=self.theme_btn_var, width=6,
                   command=self.toggle_theme).pack(side="right", padx=(8, 0))

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
        self._sync_det_method()

    def _sync_det_method(self):
        """只在选中「行列式」时露出算法下拉，插在「左」标签前面。"""
        need = self._op_key() == "det"
        if need and not self._det_cb_shown:
            self.det_method_cb.pack(side="left", padx=(0, 10),
                                    before=self._left_lbl)
            self._det_cb_shown = True
        elif not need and self._det_cb_shown:
            self.det_method_cb.pack_forget()
            self._det_cb_shown = False

    def _det_op(self):
        """当前选的行列式算法对应的 op 名（行变换 / 代数余子式展开）。"""
        return DET_METHOD_OPS.get(self.det_method_var.get(), "det")

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

        ttk.Button(editor, text="从图片导入", command=self.import_from_image).pack(side="right", padx=4)
        ttk.Button(editor, text="从剪贴板粘贴", command=self.paste_from_clipboard).pack(side="right", padx=4)

        self.edit_grid = tk.Frame(outer, bg=self.colors["panel"])
        self.edit_grid.pack(fill="x", padx=8, pady=(2, 4))

        prev = ttk.LabelFrame(outer, text="预览（引擎实际读取，空格补 0）")
        prev.pack(fill="x", padx=8, pady=(2, 8))
        self.preview = scrolledtext.ScrolledText(
            prev, bg=self.colors["field"], fg=self.colors["text"],
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
                             bg=self.colors["field"], fg=self.colors["text"],
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

    # ---- 设置（API key 等，仅存本机）--------------------------------------
    def open_settings(self):
        win = tk.Toplevel(self.root)
        win.title("设置")
        win.geometry("500x310")
        win.configure(bg=self.colors["bg"])
        s = load_settings()
        tk.Label(win, text="Gemini API Key（存于本机 ~/.la_helper_settings.json，绝不入库）:",
                 bg=self.colors["bg"], fg=self.colors["text"]).pack(
            anchor="w", padx=12, pady=(12, 2))
        key_var = tk.StringVar(value=s.get("api_key", ""))
        tk.Entry(win, textvariable=key_var, width=56, show="*",
                 bg=self.colors["field"], fg=self.colors["text"],
                 insertbackground=self.colors["accent"]).pack(
            fill="x", padx=12, pady=(0, 8))
        tk.Label(win, text="模型:", bg=self.colors["bg"], fg=self.colors["text"]).pack(
            anchor="w", padx=12, pady=(0, 2))
        model_var = tk.StringVar(value=s.get("model", photo.DEFAULT_MODEL))
        ttk.Combobox(win, textvariable=model_var, state="readonly",
                     values=list(photo.MODELS)).pack(fill="x", padx=12, pady=(0, 10))

        # 更新检查：默认开启、可关闭，也能立刻手动查一次
        check_var = tk.BooleanVar(value=bool(s.get("check_updates", True)))
        ttk.Checkbutton(win, text="启动时检查更新", variable=check_var).pack(
            anchor="w", padx=12, pady=(0, 6))
        ttk.Button(win, text="立即检查更新",
                   command=lambda: self._maybe_check_updates(force=True)).pack(
            anchor="w", padx=12, pady=(0, 10))

        def _save():
            # 合并写回：不能整体覆盖，否则会把 theme / last_update_check 抹掉
            cur = load_settings()
            cur.update({"api_key": key_var.get().strip(),
                        "model": model_var.get(),
                        "check_updates": bool(check_var.get())})
            save_settings(cur)
            win.destroy()
            self.set_msg("设置已保存")
        ttk.Button(win, text="保存", command=_save).pack(side="right", padx=12, pady=(0, 12))

    # ---- 从图片导入矩阵 ------------------------------------------------------
    def import_from_image(self):
        path = filedialog.askopenfilename(
            title="选择矩阵图片",
            filetypes=[("图片", "*.png *.jpg *.jpeg *.webp *.heic"), ("所有文件", "*.*")])
        if not path:
            return
        ext = os.path.splitext(path)[1].lower()
        mime = photo.SUPPORTED_MIME.get(ext)
        if not mime:
            self.set_msg(f"不支持的图片格式：{ext}", warn=True)
            return
        try:
            with open(path, "rb") as f:
                data = f.read()
        except Exception as e:
            self.set_msg(f"读取图片失败：{e}", warn=True)
            return
        settings = load_settings()
        api_key = settings.get("api_key", "")
        model = settings.get("model", photo.DEFAULT_MODEL)
        if not api_key:
            messagebox.showerror(
                "需要 API Key",
                "尚未配置 Gemini API Key。请点击「设置」填入"
                "（免费，aistudio.google.com 获取）。")
            return
        self.set_msg("正在识别图片…")
        self.root.update_idletasks()
        try:
            matrix, raw = photo.image_to_matrix(api_key, model, data, mime)
        except photo.PhotoError as e:
            self._show_raw("识别失败 / 无法解析，请手动核对原始返回", e.raw or str(e))
            return
        rows = len(matrix)
        cols = len(matrix[0]) if rows else 0
        self.model.resize(self.model.editing, rows, cols)
        for r in range(rows):
            for c in range(cols):
                self.model.set_cell(self.model.editing, r, c, matrix[r][c])
        self.rv.set(rows)
        self.cv.set(cols)
        self.build_edit_grid()
        self.render_preview()
        self.set_msg(f"已从图片导入 {rows}×{cols} 矩阵，请核对后计算")

    def _show_raw(self, title, text):
        win = tk.Toplevel(self.root)
        win.title(title)
        win.geometry("540x380")
        t = tk.Text(win, wrap="word", bg=self.colors["field"], fg=self.colors["text"])
        t.insert("1.0", text or "")
        t.config(state="disabled")
        t.pack(fill="both", expand=True, padx=12, pady=12)

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
            rf, bg=self.colors["field"], fg=self.colors["text"],
            insertbackground=self.colors["accent"],
            font=("Menlo", 13), wrap="word", relief="flat", bd=0,
            height=MIN_RESULT_LINES, state="disabled")
        self.out.pack(fill="x", expand=False, anchor="n", padx=10, pady=10)
        self.out.tag_configure("title", foreground=self.colors["accent"],
                               font=("Menlo", 15, "bold"))
        self.out.tag_configure("sub", foreground=self.colors["muted"],
                               font=("Menlo", 12, "bold"))
        self.out.tag_configure("warn", foreground=self.colors["warn"],
                               font=("Menlo", 13, "bold"))
        self.out.tag_configure("err", foreground=self.colors["err"],
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
                # Show a prominent decimal approximation next to an exact form
                # so the value is readable even when written in radicals.
                # (Skipped when the value already IS the decimal fallback, or
                # when the exact form is already clear at a glance -- e.g. a
                # plain integer like 2 or the imaginary unit i, where a decimal
                # "≈ 1.0*i" would only add noise.)
                exact_raw = p.get("exact") or p["value"]
                needs_approx = ("sqrt" in exact_raw) or ("/" in exact_raw)
                if (not dec) and p.get("approx") and p["value"] != p["approx"] and needs_approx:
                    self._write("≈ " + format_math.to_text(p["approx"], True), "mat")
                for v in p["vectors"]:
                    self._write(format_matrix(v, dec), "mat")
        if res.get("steps"):
            self._write("计算步骤", "title")
            for i, s in enumerate(res["steps"], 1):
                # 每步是 {text, matrix}：text 是行变换，matrix 是这一步做完之后的
                # 矩阵快照（纯说明性步骤没有矩阵）。缩进一格方便看清归属。
                label = s.get("text") if isinstance(s, dict) else s
                self._write(f"{i}. {format_math.step_text(label)}", "mat")
                mat = s.get("matrix") if isinstance(s, dict) else None
                if mat:
                    self._write("   " + format_matrix(mat, dec).replace("\n", "\n   "),
                                "mat")
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
        # Delegate to the shared formatter: it cleans sqrt(..)/**/I and shows a
        # decimal when requested, so scalar results stay readable in both modes.
        return format_math.to_text(v, dec)

    # ---- 计算 ----
    def compute_dropdown(self):
        raw_op = self._op_key()
        # 行列式：按旁边选的算法走不同 op
        op = self._det_op() if raw_op == "det" else raw_op
        show_steps = self.steps_var.get()
        payload = {"op": op, "A": self.model.data_of(self.left_var.get()),
                   "showSteps": show_steps}
        if raw_op in OPS_NEED_B:
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

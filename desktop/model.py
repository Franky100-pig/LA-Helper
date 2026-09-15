"""Named-matrix library model for the desktop app.

Mirrors the web app's ``state.lib`` (chips + a resize-preserving editor + a
live preview) but with no tkinter / core dependency, so it can be unit-tested
headlessly and is trivial to bundle with PyInstaller.

A library is ``name -> {"rows": int, "cols": int, "cells": [[str, ...], ...]}``.
Empty cells mean "0" to the engine, exactly like the web.
"""
import re

MIN_DIM = 1
MAX_DIM = 16
DEFAULT_NAMES = ["A", "B", "C", "D"]
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,7}$")
FRACTION_RE = re.compile(r"^([+-]?\d+)/([+-]?\d+)$")


def blank_cells(rows, cols):
    return [["" for _ in range(cols)] for _ in range(rows)]


def new_matrix(rows=3, cols=3):
    return {"rows": rows, "cols": cols, "cells": blank_cells(rows, cols)}


def clamp_dim(value):
    try:
        n = int(value)
    except Exception:
        n = MIN_DIM
    return max(MIN_DIM, min(MAX_DIM, n))


def resize_matrix(m, rows, cols):
    """Resize preserving the overlapping region (mirrors the web behaviour)."""
    old = m["cells"]
    cells = [
        [(old[r][c] if (r < len(old) and c < len(old[r])) else "") for c in range(cols)]
        for r in range(rows)
    ]
    m["rows"] = rows
    m["cols"] = cols
    m["cells"] = cells


def cell_to_data(v):
    s = (v or "").strip()
    return s if s != "" else "0"


def data_of(m):
    """Cells -> engine input (empty becomes "0")."""
    return [[cell_to_data(c) for c in row] for row in m["cells"]]


def matrix_data(lib):
    return {name: data_of(m) for name, m in lib.items()}


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


def format_preview(m, decimals=False):
    """Preview of what the engine will actually read (empty -> 0)."""
    return format_matrix(data_of(m), decimals)


class LibraryModel:
    """In-memory named-matrix library used by the desktop UI."""

    def __init__(self):
        self.lib = {n: new_matrix(3, 3) for n in DEFAULT_NAMES}
        self.editing = DEFAULT_NAMES[0]

    # -- queries ---------------------------------------------------------------
    def names(self):
        return sorted(self.lib)

    def get(self, name):
        return self.lib[name]

    def current(self):
        return self.lib[self.editing]

    # -- mutation --------------------------------------------------------------
    def set_cell(self, name, r, c, value):
        self.lib[name]["cells"][r][c] = value

    def resize(self, name, rows, cols):
        resize_matrix(self.lib[name], clamp_dim(rows), clamp_dim(cols))

    def clear(self, name):
        m = self.lib[name]
        m["cells"] = blank_cells(m["rows"], m["cols"])

    def add(self):
        name = self.next_name()
        self.lib[name] = new_matrix(3, 3)
        self.editing = name
        return name

    def delete(self, name):
        if len(self.lib) <= 1:
            raise ValueError("至少要保留一个矩阵")
        del self.lib[name]
        if self.editing == name:
            self.editing = self.names()[0]

    def rename(self, old, new):
        new = (new or "").strip()
        if not NAME_RE.match(new):
            raise ValueError("名称要以字母开头，最多 8 位字母或数字")
        if new in self.lib:
            raise ValueError(f"已经有一个叫 {new} 的矩阵了")
        self.lib[new] = self.lib.pop(old)
        if self.editing == old:
            self.editing = new

    def next_name(self):
        for i in range(26):
            n = chr(65 + i)
            if n not in self.lib:
                return n
        k = 1
        while f"M{k}" in self.lib:
            k += 1
        return f"M{k}"

    # -- engine conversion -----------------------------------------------------
    def data_of(self, name):
        return data_of(self.lib[name])

    def matrix_data(self):
        return matrix_data(self.lib)

"""Tests for the desktop named-matrix library model (no tkinter needed)."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from desktop.model import (
    LibraryModel,
    resize_matrix,
    data_of,
    matrix_data,
    clamp_dim,
    format_preview,
    new_matrix,
)


def test_default_library_has_four_matrices():
    lib = LibraryModel()
    assert lib.names() == ["A", "B", "C", "D"]
    assert lib.editing == "A"


def test_resize_preserves_overlap():
    m = new_matrix(3, 3)
    m["cells"][0][0] = "5"
    m["cells"][1][2] = "9"
    resize_matrix(m, 2, 4)            # shrink rows, grow cols
    assert m["rows"] == 2 and m["cols"] == 4
    assert m["cells"][0][0] == "5"    # preserved
    assert m["cells"][1][2] == "9"    # preserved
    assert m["cells"][0][3] == ""     # new cell empty


def test_resize_grow_keeps_old_data():
    m = new_matrix(2, 2)
    m["cells"][1][1] = "7"
    resize_matrix(m, 4, 4)
    assert m["cells"][1][1] == "7"
    assert m["cells"][3][3] == ""


def test_clamp_dim_limits():
    assert clamp_dim(0) == 1
    assert clamp_dim(99) == 16
    assert clamp_dim("3") == 3
    assert clamp_dim("abc") == 1


def test_data_of_blank_becomes_zero():
    m = new_matrix(2, 2)
    m["cells"][0][0] = "2"
    m["cells"][0][1] = ""
    m["cells"][1][0] = "-1"
    d = data_of(m)
    assert d[0][0] == "2"
    assert d[0][1] == "0"     # blank -> 0
    assert d[1][0] == "-1"
    assert d[1][1] == "0"


def test_matrix_data_returns_full_library():
    lib = LibraryModel()
    lib.set_cell("A", 0, 0, "3")
    md = matrix_data(lib.lib)
    assert set(md) == {"A", "B", "C", "D"}
    assert md["A"][0][0] == "3"
    assert md["A"][0][1] == "0"


def test_next_name_picks_free_letter():
    lib = LibraryModel()
    assert lib.next_name() == "E"
    for n in ("E", "F", "G"):
        lib.lib[n] = new_matrix(3, 3)
    assert lib.next_name() == "H"


def test_add_creates_matrix_and_selects_it():
    lib = LibraryModel()
    name = lib.add()
    assert name == "E"
    assert name in lib.lib
    assert lib.editing == name


def test_delete_keeps_at_least_one():
    lib = LibraryModel()
    lib.delete("D")
    assert "D" not in lib.lib
    # cannot delete the last remaining matrix
    for n in list(lib.names()):
        if len(lib.lib) > 1:
            lib.delete(n)
    try:
        lib.delete(lib.names()[0])
        assert False, "expected ValueError"
    except ValueError:
        pass
    assert len(lib.lib) == 1


def test_rename_validates():
    lib = LibraryModel()
    lib.rename("A", "M1")
    assert "M1" in lib.lib and "A" not in lib.lib
    assert lib.editing == "M1"
    # bad name
    try:
        lib.rename("M1", "_bad")
        assert False, "expected ValueError"
    except ValueError:
        pass
    # duplicate
    try:
        lib.rename("B", "C")
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_format_preview_shows_engine_interpretation():
    m = new_matrix(2, 2)
    m["cells"][0][0] = "1/2"
    preview = format_preview(m)
    # blank cells render as 0 in the preview
    assert "0" in preview
    assert "1/2" in preview

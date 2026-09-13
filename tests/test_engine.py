"""Contract tests for core.engine.compute — the only entry point the web UI uses."""
from core.engine import compute, MAX_DIM


def test_add():
    r = compute("add", [[1, 2], [3, 4]], [[1, 1], [1, 1]])
    assert r["ok"] and r["data"] == [["2", "3"], ["4", "5"]]


def test_multiply():
    r = compute("multiply", [[1, 2], [3, 4]], [[5, 6], [7, 8]])
    assert r["ok"] and r["data"] == [["19", "22"], ["43", "50"]]


def test_scalar_mul():
    r = compute("scalar", [[1, 2], [3, 4]], [[3]])
    assert r["ok"] and r["data"] == [["3", "6"], ["9", "12"]]


def test_scalar_needs_1x1():
    r = compute("scalar", [[1, 2]], [[3, 4]])
    assert not r["ok"] and "1×1" in r["error"]


def test_unknown_op():
    assert not compute("nope", [[1]])["ok"]


# --- input validation (regressions for crashes found in review) --------------

def test_empty_a_is_rejected():
    r = compute("det", None)
    assert not r["ok"] and "空" in r["error"]


def test_non_nested_a_is_rejected():
    r = compute("det", [1, 2])
    assert not r["ok"]


def test_string_a_is_rejected():
    r = compute("det", "abc")
    assert not r["ok"]


def test_oversized_matrix_is_rejected():
    big = [[1] * (MAX_DIM + 1) for _ in range(MAX_DIM + 1)]
    r = compute("det", big)
    assert not r["ok"] and "超过上限" in r["error"]


def test_unsafe_expression_is_rejected():
    """'9**9**9' used to hang the server forever."""
    r = compute("det", [["9**9**9"]])
    assert not r["ok"] and "无法识别" in r["error"]


def test_function_call_is_rejected():
    r = compute("det", [['__import__("os")']])
    assert not r["ok"]


def test_typo_is_rejected_not_silently_symbolic():
    r = compute("det", [["abc"]])
    assert not r["ok"]


def test_second_matrix_needed():
    r = compute("solve", [[1, 2], [3, 4]])
    assert not r["ok"] and "second matrix" in r["error"]


# --- results -----------------------------------------------------------------

def test_det_singular():
    r = compute("det", [[1, 2], [2, 4]])
    assert r["ok"] and r["value"] == "0"


def test_det_with_row_swap():
    r = compute("det", [[0, 1], [1, 0]])
    assert r["ok"] and r["value"] == "-1"


def test_inverse_non_square_reports_error():
    r = compute("inverse", [[1, 2, 3], [4, 5, 6]])
    assert not r["ok"] and "square" in r["error"]


def test_solve_unique():
    r = compute("solve", [[2, 1], [1, 1]], [[3], [2]])
    assert r["ok"] and r["status"] == "unique" and r["particular"] == [["1"], ["1"]]


def test_solve_none():
    r = compute("solve", [[1, 1], [1, 1]], [[1], [2]])
    assert r["ok"] and r["status"] == "none"


def test_left_inverse_missing_reports_note():
    r = compute("left_inverse", [[1, 2], [2, 4], [3, 6]])
    assert r["ok"] and r["type"] == "inverse_status" and r["exists"] is False

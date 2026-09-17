"""Contract tests for core.expr — the expression shortcut used by the web UI.

The expression box is a *shortcut* for the operation dropdown, so the two paths
must agree exactly. Several tests below assert that property directly by
comparing an expression result against `engine.compute(...)` for the equivalent
operation.
"""
import pytest

from core.engine import compute
from core import expr, ops, inverse as inv_mod
from core.matrix import Matrix

A = [["1", "2"], ["3", "4"]]
B = [["5", "6"], ["7", "8"]]
S = [["1", "2"], ["2", "4"]]          # singular, rank 1
V = [["1"], ["2"]]                    # 2x1 (a "b" column for solve)
LIB = {"A": A, "B": B, "S": S, "v": V}


def ev(text, lib=None, show_steps=True):
    # show_steps mirrors engine.compute's default so equivalence assertions
    # compare like for like.
    return expr.evaluate(text, LIB if lib is None else lib,
                         show_steps=show_steps)


def ok(text, **kw):
    r = ev(text, **kw)
    assert r["ok"], f"{text!r} failed: {r.get('error')}"
    return r


def bad(text, **kw):
    r = ev(text, **kw)
    assert not r["ok"], f"{text!r} should have failed but returned {r}"
    return r["error"]


# --- security: user text is parsed, never eval'd -----------------------------

def test_double_star_is_rejected_quickly():
    # The classic SymPy DoS. Must be a parse error, not an evaluation.
    bad("9**9**9")


def test_bare_number_expression_is_scalar():
    assert ok("2*3")["value"] == "6"


def test_unknown_name_is_rejected():
    assert "Z" in bad("Z")


def test_unknown_function_is_rejected():
    assert "eval" in bad("eval(A)")


def test_dunder_import_is_rejected():
    bad("__import__('os')")


def test_leading_underscore_name_is_rejected():
    bad("_la_compute(A)")


def test_empty_expression_is_rejected():
    bad("")


def test_whitespace_only_is_rejected():
    bad("   ")


def test_trailing_operator_is_rejected():
    bad("A +")


def test_unbalanced_open_paren_is_rejected():
    bad("(A")


def test_unbalanced_close_paren_is_rejected():
    bad("A)")


def test_huge_exponent_is_rejected():
    # A^99999 would try to multiply 99999 times.
    bad("A^99999")


def test_deep_nesting_is_rejected_not_recursion_error():
    err = bad("(" * 200 + "A" + ")" * 200)
    assert err


def test_lu_must_stand_alone():
    assert "单独" in bad("lu(A) + B")


def test_solve_must_stand_alone():
    assert "单独" in bad("solve(A, v) + B")


def test_eigen_must_stand_alone():
    assert "单独" in bad("eigen(A) + B")


def test_wrong_arity_is_reported():
    assert "参数" in bad("inv(A, B)")
    assert "参数" in bad("det()")


# --- arithmetic --------------------------------------------------------------

def test_add_matches_dropdown():
    assert ok("A + B") == compute("add", A, B)


def test_sub_matches_dropdown():
    assert ok("A - B") == compute("sub", A, B)


def test_multiply_matches_dropdown():
    assert ok("A * B") == compute("multiply", A, B)


def test_scalar_left_matches_dropdown():
    assert ok("2 * A") == compute("scalar", A, [[2]])


def test_scalar_right_matches_dropdown():
    assert ok("A * 2") == compute("scalar", A, [[2]])


def test_negation():
    r = ok("-A")
    assert r["data"] == [["-1", "-2"], ["-3", "-4"]]


def test_double_negation():
    assert ok("--A")["data"] == A


def test_division_by_scalar():
    r = ok("A / 2")
    assert r["data"] == [["1/2", "1"], ["3/2", "2"]]


def test_scalar_division_expression():
    assert ok("1 / 2")["value"] == "1/2"


def test_precedence_mul_before_add():
    # A + A*B  !=  (A + A)*B
    r = ok("A + A * B")
    manual = ops.add(Matrix(A), ops.mul(Matrix(A), Matrix(B)))
    assert r["data"] == manual.to_list()


def test_parentheses_override_precedence():
    r = ok("(A + A) * B")
    manual = ops.mul(ops.add(Matrix(A), Matrix(A)), Matrix(B))
    assert r["data"] == manual.to_list()


def test_shape_mismatch_surfaces_a_message():
    bad("A + v")


def test_undefined_name_in_operation_is_reported():
    assert "Z" in bad("A + Z")


# --- functions ---------------------------------------------------------------

def test_inv_matches_dropdown_and_keeps_steps():
    r = ok("inv(A)", show_steps=True)
    assert r == compute("inverse", A, show_steps=True)


def test_inv_without_steps_matches_dropdown():
    assert ok("inv(A)", show_steps=False) == compute(
        "inverse", A, show_steps=False)


def test_det_matches_dropdown():
    assert ok("det(A)") == compute("det", A)


def test_rank_matches_dropdown():
    assert ok("rank(S)") == compute("rank", S)


def test_transpose_matches_dropdown():
    assert ok("transpose(A)") == compute("transpose", A)


def test_transpose_short_alias_T():
    assert ok("T(A)") == compute("transpose", A)


def test_ref_matches_dropdown():
    assert ok("ref(A)") == compute("ref", A)


def test_pinv_matches_dropdown():
    assert ok("pinv(A)") == compute("pseudo_inverse", A)


def test_lu_matches_dropdown():
    assert ok("lu(A)") == compute("lu", A)


def test_solve_matches_dropdown():
    assert ok("solve(A, v)") == compute("solve", A, V)


def test_eigen_matches_dropdown():
    assert ok("eigen(A)") == compute("eigen", A)


def test_whitespace_is_ignored():
    assert ok("  inv( A )  ", show_steps=False) == compute(
        "inverse", A, show_steps=False)


def test_lowercase_function_names_are_accepted():
    assert ok("det(S)") == compute("det", S)
    assert ok("inv(A)", show_steps=False) == compute(
        "inverse", A, show_steps=False)


# --- composability -----------------------------------------------------------

def test_matrix_power_two():
    r = ok("A^2")
    assert r["data"] == ops.mul(Matrix(A), Matrix(A)).to_list()


def test_matrix_power_zero_is_identity():
    assert ok("A^0")["data"] == [["1", "0"], ["0", "1"]]


def test_matrix_power_negative_one_is_inverse():
    assert ok("A^-1")["data"] == inv_mod.inverse(Matrix(A))[0].to_list()


def test_matrix_power_three():
    r = ok("A^3")
    manual = ops.mul(ops.mul(Matrix(A), Matrix(A)), Matrix(A))
    assert r["data"] == manual.to_list()


def test_chained_expression_inv_times_B():
    r = ok("inv(A) * B")
    manual = ops.mul(inv_mod.inverse(Matrix(A))[0], Matrix(B))
    assert r["data"] == manual.to_list()


def test_chained_expression_with_subtraction():
    r = ok("inv(A) * B - A")
    manual = ops.sub(ops.mul(inv_mod.inverse(Matrix(A))[0], Matrix(B)),
                     Matrix(A))
    assert r["data"] == manual.to_list()


def test_nested_scalar_function_of_product():
    assert ok("det(A * B)") == compute("det",
                                       ops.mul(Matrix(A), Matrix(B)).to_list())


def test_composite_expression_reports_no_steps():
    # Steps only make sense for a single outer operation.
    assert ok("inv(A) * B")["steps"] == []


def test_scalar_times_inverse():
    r = ok("3 * inv(A)")
    manual = ops.scalar_mul(inv_mod.inverse(Matrix(A))[0], 3)
    assert r["data"] == manual.to_list()


def test_transpose_of_product():
    r = ok("T(A * B)")
    manual = ops.transpose(ops.mul(Matrix(A), Matrix(B)))
    assert r["data"] == manual.to_list()


# --- result envelope ---------------------------------------------------------

def test_matrix_result_envelope_shape():
    r = ok("A + B")
    assert r["type"] == "matrix" and isinstance(r["data"], list)
    assert r["data"] and r["data"][0][0] == "6"


def test_scalar_result_envelope_shape():
    r = ok("det(A)")
    assert r["type"] == "scalar" and r["value"] == "-2"


def test_empty_library_reports_missing_matrix():
    assert "A" in bad("A + A", lib={})


def test_error_includes_position_for_syntax_errors():
    # A caret/position hint makes the expression box debuggable.
    err = bad("A + * B")
    assert "位置" in err or "^" in err


# --- the shared dispatch entry point ----------------------------------------

def test_dispatch_routes_op_requests():
    from core.engine import dispatch
    assert dispatch({"op": "det", "A": A}) == compute("det", A)


def test_dispatch_routes_expr_requests():
    from core.engine import dispatch
    assert dispatch({"expr": "det(A)", "matrices": {"A": A}}) == compute("det", A)


def test_dispatch_prefers_expr_when_both_present():
    from core.engine import dispatch
    r = dispatch({"expr": "det(A)", "matrices": {"A": A}, "op": "rank", "A": A})
    assert r["value"] == "-2"


def test_dispatch_rejects_non_dict():
    from core.engine import dispatch
    assert not dispatch("nope")["ok"]


def test_dispatch_op_without_matrices_is_an_error_not_a_crash():
    from core.engine import dispatch
    assert not dispatch({"expr": "inv(A)"})["ok"]

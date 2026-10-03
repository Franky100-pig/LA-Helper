"""Dispatch an operation to the core modules; produce a JSON-friendly result."""
from .matrix import Matrix
from . import i18n
from . import ops, inverse as inv_mod, lu as lu_mod, solve, det_rank, eigen as eig_mod

# Hard upper bound on input size: exact arithmetic on a 100x100 would happily
# burn the (single-threaded) server for minutes.
MAX_DIM = 16


def _mat(M):
    return M.to_list()


def _parse(name, data, allow_symbols=False):
    """Parse + validate one matrix. Returns (Matrix, error_message)."""
    try:
        M = Matrix(data, allow_symbols=allow_symbols)
    except Exception as e:
        return None, i18n.tr("err.engine.parse", name=name, detail=e)
    if M.is_empty():
        return None, i18n.tr("err.engine.empty", name=name)
    if M.rows > MAX_DIM or M.cols > MAX_DIM:
        return None, i18n.tr("err.engine.too_big", name=name,
                             rows=M.rows, cols=M.cols, limit=MAX_DIM)
    return M, None


def dispatch(req):
    """Single entry point shared by the local server and the Pyodide bridge.

    A request either carries ``op`` (the dropdown path) or ``expr`` (the
    expression shortcut). Both funnel into the same underlying operations, so
    the two paths can never drift apart.

    ``req["lang"]`` ("zh" / "en") decides the language of every step and error
    this call produces. It is read here, once, before any work starts — see
    core/i18n.py for why the language is module-level rather than a parameter.
    Callers that omit it get the previous behaviour (Chinese).
    """
    if not isinstance(req, dict):
        return {"ok": False, "error": i18n.tr("err.engine.bad_request")}
    i18n.set_lang(req.get("lang"))
    show_steps = bool(req.get("showSteps", True))
    if req.get("expr"):
        from . import expr as expr_mod          # local import: expr imports us
        return expr_mod.evaluate(req["expr"], req.get("matrices") or {},
                                 show_steps=show_steps)
    return compute(req.get("op"), req.get("A"), req.get("B"), show_steps)


def compute(op, A_data, B_data=None, show_steps=True, allow_symbols=False):
    """Run one dropdown operation and return a JSON-friendly result dict.

    The desktop app calls this directly (it has no language switcher, so the
    engine keeps its default Chinese); the web editions go through
    :func:`dispatch`, which sets the language from the request first.

    Never raises: a bad matrix or a failed operation comes back as
    ``{"ok": False, "error": …}``, because every caller is a UI.
    """
    try:
        A, err = _parse("A", A_data, allow_symbols)
        if err:
            return {"ok": False, "error": err}

        need_B = op in ("add", "sub", "multiply", "solve", "scalar")
        if need_B and B_data is None:
            return {"ok": False, "error": i18n.tr("err.engine.needs_b")}

        def B_matrix():
            return _parse("B", B_data, allow_symbols)

        if op in ("add", "sub", "multiply"):
            B, err = B_matrix()
            if err:
                return {"ok": False, "error": err}
            R = {"add": ops.add, "sub": ops.sub, "multiply": ops.mul}[op](A, B)
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": []}
        elif op == "scalar":
            B, err = B_matrix()
            if err:
                return {"ok": False, "error": err}
            if B.shape != (1, 1):
                return {"ok": False,
                        "error": i18n.tr("err.engine.scalar_needs_1x1")}
            R = ops.scalar_mul(A, B.data[0][0])
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": []}
        elif op == "transpose":
            R = ops.transpose(A)
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": []}
        elif op == "inverse":
            # 奇异矩阵没有逆。这不是「出错」，而是一个值得讲清楚的结果，
            # 所以走和 left/right inverse 一样的 inverse_status 通道，
            # 而不是把 ValueError 的英文原文抛给界面。
            # 用 determinant 判奇异（方阵 det=0 等价于不可逆），不新增公开 API。
            if not A.is_square():
                return {"ok": False,
                        "error": i18n.tr("err.engine.inverse_needs_square",
                                       rows=A.rows, cols=A.cols)}
            d, _ = det_rank.determinant(A, record_steps=False)
            if d == 0:
                return {"ok": True, "type": "inverse_status", "exists": False,
                        "note": i18n.tr("note.engine.det_zero"),
                        "steps": []}
            R, steps = inv_mod.inverse(A, record_steps=show_steps)
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": steps}
        elif op == "left_inverse":
            R, note = inv_mod.left_inverse(A, record_steps=show_steps)
            if R is None:
                return {"ok": True, "type": "inverse_status",
                        "exists": False, "note": note, "steps": []}
            return {"ok": True, "type": "matrix", "data": _mat(R),
                    "steps": (note if show_steps else [])}
        elif op == "right_inverse":
            R, note = inv_mod.right_inverse(A, record_steps=show_steps)
            if R is None:
                return {"ok": True, "type": "inverse_status",
                        "exists": False, "note": note, "steps": []}
            return {"ok": True, "type": "matrix", "data": _mat(R),
                    "steps": (note if show_steps else [])}
        elif op == "pseudo_inverse":
            R, steps = inv_mod.pseudo_inverse(A, record_steps=show_steps)
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": steps}
        elif op == "lu":
            P, L, U, swaps, steps = lu_mod.lu_decomposition(
                A, pivot=True, record_steps=show_steps)
            return {"ok": True, "type": "lu",
                    "P": _mat(P), "L": _mat(L), "U": _mat(U), "steps": steps}
        elif op == "solve":
            B, err = B_matrix()
            if err:
                return {"ok": False, "error": err}
            sol = solve.solve_augmented(A, B, record_steps=show_steps)
            return {"ok": True, "type": "solve",
                    "status": sol["status"],
                    "particular": _mat(sol["particular"]) if sol["particular"] is not None else None,
                    "null_basis": [_mat(v) for v in sol["null_basis"]],
                    "free_vars": sol["free_vars"],
                    "steps": sol["steps"]}
        elif op == "ref":
            M, steps = det_rank.ref_wrap(A, record_steps=show_steps)
            return {"ok": True, "type": "matrix", "data": _mat(M), "steps": steps}
        elif op == "det":
            d, steps = det_rank.determinant(A, record_steps=show_steps)
            return {"ok": True, "type": "scalar", "value": str(d), "steps": steps}
        elif op == "det_cofactor":
            d, steps = det_rank.determinant(A, record_steps=show_steps,
                                            method="cofactor")
            return {"ok": True, "type": "scalar", "value": str(d), "steps": steps}
        elif op == "cofactor_matrix":
            C, adj, det, steps = det_rank.cofactor_matrix(
                A, record_steps=show_steps)
            return {"ok": True, "type": "cofactor",
                    "C": _mat(Matrix(C)), "adj": _mat(Matrix(adj)),
                    "det": str(det), "steps": steps}
        elif op == "rank":
            r = det_rank.rank(A)
            return {"ok": True, "type": "scalar", "value": str(r), "steps": []}
        elif op == "eigen":
            pairs = eig_mod.eigen(A)
            return {"ok": True, "type": "eigen",
                    "pairs": [{"value": p["value"], "exact": p["exact"],
                               "approx": p["approx"],
                               "multiplicity": p["multiplicity"],
                               "geometric": p["geometric"],
                               "defective": p["defective"],
                               "vectors": [_mat(v) for v in p["vectors"]]}
                              for p in pairs], "steps": []}
        else:
            return {"ok": False, "error": i18n.tr("err.engine.unknown_op", op=op)}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

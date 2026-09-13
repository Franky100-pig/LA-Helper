"""Dispatch an operation to the core modules; produce a JSON-friendly result."""
from .matrix import Matrix
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
        return None, f"矩阵 {name} 输入有误：{e}"
    if M.is_empty():
        return None, f"矩阵 {name} 为空，请至少填写一个元素"
    if M.rows > MAX_DIM or M.cols > MAX_DIM:
        return None, (
            f"矩阵 {name} 是 {M.rows}×{M.cols}，超过上限 {MAX_DIM}×{MAX_DIM}"
        )
    return M, None


def compute(op, A_data, B_data=None, show_steps=True, allow_symbols=False):
    try:
        A, err = _parse("A", A_data, allow_symbols)
        if err:
            return {"ok": False, "error": err}

        need_B = op in ("add", "sub", "multiply", "solve", "scalar")
        if need_B and B_data is None:
            return {"ok": False, "error": "This operation needs a second matrix B / b."}

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
                        "error": "标量乘法需要在 B 中填 1×1 的常数（把 B 设成 1 行 1 列）"}
            R = ops.scalar_mul(A, B.data[0][0])
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": []}
        elif op == "transpose":
            R = ops.transpose(A)
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": []}
        elif op == "inverse":
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
        elif op == "rref":
            M, steps = det_rank.rref_wrap(A, record_steps=show_steps)
            return {"ok": True, "type": "matrix", "data": _mat(M), "steps": steps}
        elif op == "det":
            d, steps = det_rank.determinant(A, record_steps=show_steps)
            return {"ok": True, "type": "scalar", "value": str(d), "steps": steps}
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
            return {"ok": False, "error": f"Unknown operation: {op}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

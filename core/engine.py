"""Dispatch an operation to the core modules; produce a JSON-friendly result."""
from .matrix import Matrix
from . import ops, inverse as inv_mod, lu as lu_mod, solve, det_rank, eigen as eig_mod


def _mat(M):
    return M.to_list()


def compute(op, A_data, B_data=None, show_steps=True):
    try:
        A = Matrix(A_data)
    except Exception as e:
        return {"ok": False, "error": f"Invalid matrix A: {e}"}

    try:
        need_B = op in ("add", "sub", "multiply", "solve")
        if need_B and B_data is None:
            return {"ok": False, "error": "This operation needs a second matrix B / b."}

        if op == "add":
            R = ops.add(A, Matrix(B_data))
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": []}
        elif op == "sub":
            R = ops.sub(A, Matrix(B_data))
            return {"ok": True, "type": "matrix", "data": _mat(R), "steps": []}
        elif op == "multiply":
            R = ops.mul(A, Matrix(B_data))
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
            sol = solve.solve_augmented(A, Matrix(B_data), record_steps=show_steps)
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
                    "pairs": [{"value": p["value"], "multiplicity": p["multiplicity"],
                               "vectors": [_mat(v) for v in p["vectors"]]}
                              for p in pairs], "steps": []}
        else:
            return {"ok": False, "error": f"Unknown operation: {op}"}
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {e}"}

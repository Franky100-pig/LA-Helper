"""Eigenvalues and eigenvectors, characteristic polynomial factoring, and diagonalization."""
import re
from .matrix import Matrix, fmt_expr, step
from . import i18n
import sympy as sp

# >= this size, default to the numeric path (exact is unusably slow/unreadable)
EIGEN_NUMERIC_MIN = 5
PRECISION = 6

# An exact form longer than this reads like machine output, not math (e.g. the
# Cardano formula SymPy gives for a cubic with three real roots runs 100+
# chars of nested cube roots). Those fall back to the decimal value.
READABLE_MAX_LEN = 60

# Imaginary parts below this (relative) are float round-off, not physics.
NOISE = 1e-10


def _clean_noise(v):
    """Drop a negligible imaginary part that is pure numerical round-off."""
    try:
        re_, im_ = sp.re(v), sp.im(v)
        if im_.is_number and abs(im_) < NOISE * max(1, abs(re_)):
            return re_
    except Exception:
        pass
    return v


def _is_readable(v):
    """True if v can be shown to a student without scaring them."""
    if v.has(sp.CRootOf) or v.has(sp.RootOf) or v.has(sp.Lambda):
        return False
    return len(str(v)) <= READABLE_MAX_LEN


def _fmt_num(v, precision):
    """Short numeric string; handles complex values (sp.Float would not)."""
    v = _clean_noise(v)
    try:
        return str(sp.Float(sp.N(v, precision), precision))
    except (TypeError, ValueError):
        return str(sp.N(v, precision))


def _fmt_poly(e, lam):
    """Clean polynomial string for display."""
    s = str(sp.expand(e)).replace(str(lam), "λ").replace("**", "^")
    s = re.sub(r"(\d+)\*λ", r"\1λ", s)
    return s.replace("*", "")


def _fmt_factored(e, lam):
    """Clean factored polynomial string for display."""
    s = str(e).replace(str(lam), "λ").replace("**", "^")
    s = re.sub(r"(\d+)\*\(", r"\1(", s)
    return s.replace("*", "")


def characteristic_polynomial(A, record_steps=True):
    """Compute characteristic polynomial det(A - λI), factoring, and steps."""
    if not A.is_square():
        raise ValueError(f"characteristic_polynomial needs a square matrix, got {A.shape}")
    n = A.rows
    lam = sp.Symbol("lambda")
    M = A.to_sympy()
    I = sp.eye(n)
    char_M = M - lam * I
    p = sp.simplify(char_M.det())
    factored = sp.factor(p)

    poly_str = _fmt_poly(p, lam)
    factored_str = _fmt_factored(factored, lam)

    steps = []
    if record_steps:
        # Step 1: Characteristic matrix A - λI
        grid = []
        for i in range(n):
            row = []
            for j in range(n):
                cell = char_M[i, j]
                cell_s = str(cell).replace(str(lam), "λ").replace("**", "^").replace("*", "")
                row.append(cell_s)
            grid.append(row)
        steps.append(step(i18n.tr("eigen.step.char_matrix"), grid, op="note"))
        steps.append(step(i18n.tr("eigen.step.char_poly", poly=poly_str), op="note"))
        steps.append(step(i18n.tr("eigen.step.char_poly_factored", factored=factored_str), op="note"))

    return {
        "poly": p,
        "poly_str": poly_str,
        "factored": factored,
        "factored_str": factored_str,
        "steps": steps,
    }


def eigen(A, numeric=None, precision=PRECISION, record_steps=False):
    """Return list of {value, exact, approx, multiplicity, geometric, defective,
    vectors} for the eigenvalues of A.
    If record_steps=True, returns (pairs, steps).
    """
    if not A.is_square():
        raise ValueError(f"eigen needs a square matrix, got {A.shape}")
    n = A.rows
    if numeric is None:
        numeric = n >= EIGEN_NUMERIC_MIN

    M = A.to_sympy()
    char_info = characteristic_polynomial(A, record_steps=record_steps) if not numeric else None
    steps = list(char_info["steps"]) if (record_steps and char_info) else []

    # The walkthrough opens by deriving the characteristic equation — students
    # asked to see "where the eigenvalues come from", not just a matrix dump.
    # On the numerical path there is no exact polynomial to show, so say so.
    if record_steps:
        steps.insert(0, step(i18n.tr("eigen.step.start"), op="note"))
        if numeric:
            steps.append(step(i18n.tr("eigen.step.numeric"), op="note"))

    if numeric:
        M_calc = M.evalf(15)
    else:
        M_calc = M

    vecs = M_calc.eigenvects()  # (eigenvalue, algebraic_multiplicity, [vectors])
    pairs = []

    if record_steps and vecs and not numeric:
        # Use exactly the value the result card will show for each eigenvalue.
        # An unwieldy exact root would otherwise produce a 500-char line here
        # while λ reads "-1.51711" everywhere else.
        roots_parts = []
        for val, mult, _ in vecs:
            v = sp.simplify(val)
            shown_v = fmt_expr(v) if _is_readable(v) else _fmt_num(v, precision)
            roots_parts.append(f"λ = {shown_v} (AM={mult})")
        steps.append(step(i18n.tr("eigen.step.eigenvalues",
                                  roots=", ".join(roots_parts)), op="note"))

    I = sp.eye(n)
    for val, mult, basis in vecs:
        v = sp.simplify(val)
        exact = fmt_expr(v)
        readable = _is_readable(v)
        approx = _fmt_num(v, precision)
        shown = approx if (numeric or not readable) else exact
        vectors = []
        shown_vecs = []          # same values the result card shows (numeric when needed)
        for b in basis:
            if numeric or not readable:
                b = b.evalf(precision).applyfunc(_clean_noise)
            shown_vecs.append(b)
            vectors.append(Matrix.from_sympy(b))

        geom = len(basis)
        is_defective = geom < mult

        if record_steps and not numeric:
            A_sub = M - v * I
            # When λ is an unwieldy radical, the *displayed* system should use
            # the same decimal the result card shows. Otherwise this snapshot
            # is a 180-character formula while the answer next to it says 1.51711.
            grid_src = A_sub if readable else M - sp.N(v, precision) * I
            sub_grid = [[fmt_expr(sp.simplify(grid_src[r, c]))
                         for c in range(n)] for r in range(n)]
            steps.append(step(
                i18n.tr("eigen.step.eigenspace", val=shown, mult=mult),
                sub_grid, op="note"
            ))
            # Show the row reduction itself: the pivot columns tell you which
            # variables are locked, the free ones become the parameters in the
            # special solutions. Without this the basis looks like magic.
            #
            # Guard: only on a short, *exact* eigenvalue. A cubic with three
            # irrational roots gives a 180-char Cardano radical — rref() on that
            # does not finish (measured >15 s, process killed), and an rref built
            # from a numeric λ is just the identity because λ is only an
            # approximation, so A − λI is not exactly singular. Neither is
            # worth showing; say so instead of faking a step.
            rref_step = None
            if readable and sp.count_ops(A_sub) < 80:
                try:
                    rref_mat, pivots = A_sub.rref()
                    rref_grid = [[fmt_expr(sp.simplify(rref_mat[r, c]))
                                  for c in range(n)] for r in range(n)]
                    pivot_cols = ", ".join(str(j + 1) for j in pivots) or "—"
                    free_vars = ", ".join("x" + str(j + 1) for j in range(n)
                                          if j not in pivots) or "—"
                    rref_step = step(
                        i18n.tr("eigen.step.rref", pivots=pivot_cols, free=free_vars),
                        rref_grid, op="note"
                    )
                except Exception:
                    pass
            steps.append(rref_step or step(
                i18n.tr("eigen.step.rref_skipped", val=shown), op="note"
            ))
            vec_strs = ["[" + ", ".join(fmt_expr(b[r]) for r in range(n)) + "]ᵀ"
                        for b in shown_vecs]
            vec_join = ", ".join(vec_strs)
            # Keep both keys as full literals: a dynamic "eigen.step." + name
            # would trip the i18n guard's missing-key scan.
            if rref_step:
                basis_text = i18n.tr("eigen.step.eigenspace_basis",
                                     val=shown, geom=geom, vectors=vec_join)
            else:
                basis_text = i18n.tr("eigen.step.basis_numeric",
                                     geom=geom, vectors=vec_join)
            steps.append(step(basis_text, op="note"))
            # One multiplication against the definition catches sign / pairing
            # slips, and closes the loop for this eigenvalue.
            if shown_vecs and readable:
                try:
                    b0 = shown_vecs[0]
                    img = M * b0
                    vec_s = "[" + ", ".join(fmt_expr(sp.simplify(b0[r])) for r in range(n)) + "]"
                    img_s = "[" + ", ".join(fmt_expr(sp.simplify(img[r])) for r in range(n)) + "]"
                    steps.append(step(
                        i18n.tr("eigen.step.verify", vec=vec_s, image=img_s, val=shown),
                        op="note"
                    ))
                except Exception:
                    pass
            if is_defective:
                steps.append(step(
                    i18n.tr("eigen.step.defective", val=shown, geom=geom, mult=mult),
                    op="note"
                ))

        pairs.append({
            "value": shown,
            "exact": exact,
            "approx": approx,
            "multiplicity": mult,
            "geometric": geom,
            "defective": is_defective,
            "numeric": bool(numeric or not readable),
            "vectors": vectors,
        })

    if record_steps:
        return pairs, steps
    return pairs


def diagonalize(A, record_steps=True):
    """Decompose square matrix A into P · D · P⁻¹ if diagonalizable."""
    if not A.is_square():
        raise ValueError(f"diagonalize needs a square matrix, got {A.shape}")
    n = A.rows
    res_eigen = eigen(A, record_steps=record_steps)
    pairs, steps = res_eigen if record_steps else (res_eigen, [])

    sum_gm = sum(p["geometric"] for p in pairs)
    diagonalizable = (sum_gm == n)

    if not diagonalizable:
        note_str = i18n.tr("eigen.diag.fail", sum_gm=sum_gm, n=n)
        if record_steps:
            steps.append(step(note_str, op="note"))
        return {
            "diagonalizable": False,
            "P": None,
            "D": None,
            "P_inv": None,
            "pairs": pairs,
            "steps": steps,
            "note": note_str,
        }

    all_vectors = []
    diag_vals = []
    for p in pairs:
        for v in p["vectors"]:
            all_vectors.append(v)
            diag_vals.append(p["exact"] if p.get("exact") else p["value"])

    P_data = [[all_vectors[c].data[r][0] for c in range(n)] for r in range(n)]
    P = Matrix(P_data)

    D_data = [[sp.Integer(0)] * n for _ in range(n)]
    for i in range(n):
        D_data[i][i] = sp.sympify(diag_vals[i])
    D = Matrix(D_data)

    from . import inverse as inv_mod
    P_inv, _ = inv_mod.inverse(P, record_steps=False)

    if record_steps:
        steps.append(step(i18n.tr("eigen.diag.success", sum_gm=sum_gm, n=n), op="note"))
        steps.append(step(i18n.tr("eigen.diag.pd"), P.to_list(), op="note"))
        steps.append(step(i18n.tr("eigen.diag.verify"), D.to_list(), op="note"))

    return {
        "diagonalizable": True,
        "P": P,
        "D": D,
        "P_inv": P_inv,
        "pairs": pairs,
        "steps": steps,
        "note": i18n.tr("eigen.diag.title"),
    }

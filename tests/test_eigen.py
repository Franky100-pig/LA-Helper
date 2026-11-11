import re
import time

from core.matrix import Matrix
from core import eigen


def test_eigen_diag():
    A = Matrix([[2, 0], [0, 3]])
    pairs = eigen.eigen(A)
    vals = sorted(p["value"] for p in pairs)
    assert vals == ["2", "3"]


def test_eigen_jordan():
    A = Matrix([[1, 1], [0, 1]])
    pairs = eigen.eigen(A)
    assert len(pairs) == 1
    assert pairs[0]["value"] == "1"
    assert pairs[0]["multiplicity"] == 2


def test_eigen_unwieldy_exact_falls_back_to_decimal():
    # This cubic has three real roots, but SymPy's "exact" Cardano form is a
    # 100+ char nest of complex cube roots -- machine output, not math. The
    # readability gate must fall back to clean decimals for value AND vectors.
    A = Matrix([[3, 5, 6], [2, 6, 7], [1, 4, 7]])
    pairs = eigen.eigen(A)
    assert len(pairs) == 3
    for p in pairs:
        assert len(p["value"]) <= eigen.READABLE_MAX_LEN
        assert "**" not in p["value"] and "I" not in p["value"]
        # vectors are decimals too, with no round-off imaginary noise
        for vec in p["vectors"]:
            for row in vec.to_list():
                for cell in row:
                    assert "**" not in cell and "sqrt" not in cell and "I" not in cell
    # decimal values are clean plain floats (no imaginary noise) and correct
    vals = sorted(float(p["approx"]) for p in pairs)
    assert abs(vals[0] - 0.738) < 1e-2
    assert abs(vals[1] - 1.930) < 1e-2
    assert abs(vals[2] - 13.33) < 1e-2


def test_eigen_readable_exact_stays_exact():
    # The golden-ratio matrix keeps its exact radical form (short enough).
    A = Matrix([[1, 1], [1, 0]])
    pairs = eigen.eigen(A)
    assert all("sqrt" in p["value"] for p in pairs)
    assert all(p["approx"] for p in pairs)


def test_characteristic_polynomial_and_factoring_steps():
    A = Matrix([[2, 1, 0], [0, 2, 0], [0, 0, 3]])
    char_res = eigen.characteristic_polynomial(A, record_steps=True)
    assert "λ" in char_res["poly_str"]
    assert "λ" in char_res["factored_str"]
    assert len(char_res["steps"]) == 3
    # First step carries characteristic matrix snapshot A - λI
    s0 = char_res["steps"][0]
    assert s0["matrix"] is not None
    assert any("λ" in cell for row in s0["matrix"] for cell in row)
    # Second and third are polynomial and factored equations
    assert "p(λ)" in char_res["steps"][1]["text"]
    assert "p(λ)" in char_res["steps"][2]["text"]


def test_eigen_with_step_by_step_walkthrough():
    A = Matrix([[2, 1, 0], [0, 2, 0], [0, 0, 3]])
    pairs, steps = eigen.eigen(A, record_steps=True)
    assert len(pairs) == 2
    # lambda = 2 has AM=2, GM=1 -> defective
    p2 = next(p for p in pairs if p["value"] == "2")
    assert p2["multiplicity"] == 2
    assert p2["geometric"] == 1
    assert p2["defective"] is True

    # lambda = 3 has AM=1, GM=1 -> non-defective
    p3 = next(p for p in pairs if p["value"] == "3")
    assert p3["multiplicity"] == 1
    assert p3["geometric"] == 1
    assert p3["defective"] is False

    # Steps include char matrix, poly, factored poly, eigenvalues, eigenspaces, defective note
    step_texts = [s["text"] for s in steps]
    assert any("p(λ)" in t for t in step_texts)
    assert any("AM = 2" in t or "AM=2" in t for t in step_texts)
    assert any("GM = 1" in t for t in step_texts)


def test_eigen_steps_start_from_characteristic_equation_and_show_work():
    """The calculator must not jump from a matrix snapshot to a basis vector.

    A student asked for the derivation to start at "find the eigenvalues", so
    the walkthrough has to be a chain: Av = λv -> det(A-λI)=0 -> polynomial ->
    roots -> (per eigenvalue) RREF + free variables -> basis -> check Av = λv.
    """
    A = Matrix([[4, 1], [2, 3]])
    pairs, steps = eigen.eigen(A, record_steps=True)
    texts = [s["text"] for s in steps]

    # 1. First step derives the characteristic equation, not just the matrix.
    assert "Av = λv" in texts[0]
    assert "det(A − λI) = 0" in texts[0]

    # 2. Polynomial -> factored -> roots, in that order.
    i_poly = next(i for i, t in enumerate(texts) if "p(λ)" in t and "det(A − λI)" in t)
    i_fact = next(i for i, t in enumerate(texts) if "因式分解" in t)
    i_roots = next(i for i, t in enumerate(texts) if "AM" in t)
    assert i_poly < i_fact < i_roots

    # 3. Every eigenvalue gets a row-reduced snapshot (with pivot/free info),
    #    not a bare "solve this system" line.
    rref_steps = [s for s in steps if s["matrix"] is not None and "RREF" in s["text"]]
    assert len(rref_steps) == len(pairs)
    assert any("自由变量" in t for t in texts)

    # 4. The basis is verified against the definition.
    assert any("代回验证" in t and "✓" in t for t in texts)


def test_eigen_steps_are_bilingual():
    """New steps must not leak Chinese into the English UI (or vice versa)."""
    from core import i18n
    A = Matrix([[4, 1], [2, 3]])
    old = i18n.get_lang()
    try:
        i18n.set_lang("en")
        _, steps = eigen.eigen(A, record_steps=True)
        texts = [s["text"] for s in steps]
        assert "characteristic equation" in texts[0].lower()
        assert any("RREF" in t for t in texts)
        assert any("Check Av = λv" in t for t in texts)
        assert not any("\u4e00" <= ch <= "\u9fff" for t in texts for ch in t)
    finally:
        i18n.set_lang(old)


def test_eigen_unreadable_roots_keep_steps_short_and_numeric():
    """A cubic with irrational roots must not hang or dump a 180-char radical.

    Exact rref() on a Cardano radical does not terminate, and a numeric λ is
    not exactly singular, so its rref is the identity. Both are wrong to show:
    the step says the reduction was skipped, and the system/basis use the same
    decimals as the result card.
    """
    import time
    A = Matrix([[2, 0, 1], [1, 3, 2], [4, 1, 0]])
    t0 = time.time()
    pairs, steps = eigen.eigen(A, record_steps=True)
    assert time.time() - t0 < 20, "exact row reduction blew up on an irrational root"

    texts = [s["text"] for s in steps]
    assert sum("精确行化简不可靠" in t for t in texts) == len(pairs)
    # No step should contain a Cardano radical / giant exact formula.
    assert all(len(t) < 320 for t in texts), [len(t) for t in texts]
    # The basis step matches the numeric vector shown in the result card:
    # decimals, not a nested-radical expression.
    basis_steps = [t for t in texts if "特征向量基" in t]
    assert basis_steps
    assert all("**" not in t and "sqrt" not in t for t in basis_steps)
    assert any(re.search(r"\d\.\d", t) for t in basis_steps)


def test_eigen_numeric_path_explains_the_shortcut():
    """When exact factoring is skipped, say so instead of showing no steps."""
    pairs, steps = eigen.eigen(Matrix([[4, 1], [2, 3]]),
                               numeric=True, record_steps=True)
    assert pairs
    assert steps and "数值" in steps[-1]["text"]


def test_diagonalize_invertible_matrix():
    A = Matrix([[2, 1], [0, 3]])
    res = eigen.diagonalize(A, record_steps=True)
    assert res["diagonalizable"] is True
    assert res["P"] is not None and res["D"] is not None and res["P_inv"] is not None
    # Verify P * D * P_inv == A
    from core import ops
    PDP = ops.mul(ops.mul(res["P"], res["D"]), res["P_inv"])
    assert PDP.to_list() == A.to_list()
    # Check steps describe modal matrix construction and verification
    step_texts = [s["text"] for s in res["steps"]]
    assert any("P" in t and "D" in t for t in step_texts)


def test_diagonalize_defective_matrix():
    A = Matrix([[1, 1], [0, 1]])
    res = eigen.diagonalize(A, record_steps=True)
    assert res["diagonalizable"] is False
    assert res["P"] is None
    assert res["D"] is None
    assert "不可对角化" in res["note"]
    step_texts = [s["text"] for s in res["steps"]]
    assert any("不可对角化" in t for t in step_texts)

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

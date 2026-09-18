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

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

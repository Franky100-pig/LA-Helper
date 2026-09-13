from core.matrix import Matrix
from core import solve, ops


def test_unique():
    A = Matrix([[2, 1], [1, 1]])
    b = Matrix([[3], [2]])
    s = solve.solve_augmented(A, b, record_steps=False)
    assert s["status"] == "unique"
    assert s["particular"].to_list() == [["1"], ["1"]]


def test_none():
    A = Matrix([[1, 1], [1, 1]])
    b = Matrix([[1], [2]])
    s = solve.solve_augmented(A, b, record_steps=False)
    assert s["status"] == "none"


def test_infinite():
    A = Matrix([[1, 1], [2, 2]])
    b = Matrix([[2], [4]])
    s = solve.solve_augmented(A, b, record_steps=False)
    assert s["status"] == "infinite"
    # particular satisfies A x = b
    assert ops.mul(A, s["particular"]).to_list() == b.to_list()
    # null-space basis vectors satisfy A v = 0
    zero = Matrix([["0"], ["0"]])
    for v in s["null_basis"]:
        assert ops.mul(A, v).to_list() == zero.to_list()

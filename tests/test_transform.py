"""T(x) = A·x: values, orientation handling, and localized errors."""
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from core import i18n                      # noqa: E402
from core.engine import compute            # noqa: E402


@pytest.fixture(autouse=True)
def _reset_lang():
    """The engine's language is module-global; don't leak it into other tests."""
    yield
    i18n.set_lang("zh")


def test_basic_column_vector():
    i18n.set_lang("en")
    res = compute("transform", [[2, 1], [1, -1]], [[3], [1]], show_steps=True)
    assert res["ok"]
    assert res["type"] == "matrix"
    assert res["data"] == [["7"], ["2"]]
    # intro + one step per output row + done
    assert len(res["steps"]) == 4
    assert all(s["op"] == "note" for s in res["steps"])


def test_row_vector_is_transposed():
    i18n.set_lang("en")
    res = compute("transform", [[2, 1], [1, -1]], [[3, 1]], show_steps=False)
    assert res["ok"]
    assert res["data"] == [["7"], ["2"]]
    assert res["steps"] == []


def test_dimension_mismatch_is_localized():
    i18n.set_lang("en")
    res = compute("transform", [[2, 1], [1, -1]], [[3], [1], [2]], show_steps=False)
    assert not res["ok"]
    assert "expected 2" in res["error"]

    i18n.set_lang("zh")
    res = compute("transform", [[2, 1], [1, -1]], [[3], [1], [2]], show_steps=False)
    assert not res["ok"]
    assert "需要 2 个" in res["error"]


def test_non_vector_is_rejected():
    i18n.set_lang("en")
    res = compute("transform", [[2, 1], [1, -1]], [[1, 2], [3, 4]], show_steps=False)
    assert not res["ok"]
    assert "must be a vector" in res["error"]


def test_expression_path():
    """transform(A, B) must go through the same compute() as the dropdown."""
    i18n.set_lang("en")
    from core.expr import evaluate
    res = evaluate("transform(A, B)",
                   {"A": [["2", "1"], ["1", "-1"]], "B": [["3"], ["1"]]},
                   show_steps=True)
    assert res["ok"]
    assert res["data"] == [["7"], ["2"]]
    assert len(res["steps"]) == 4

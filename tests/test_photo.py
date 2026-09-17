"""Tests for the photo -> matrix parser (no network / API key needed)."""
import pytest

from core.photo import parse_matrix_response, PhotoError, build_prompt


def test_clean_json_ints():
    out = parse_matrix_response('[["1","2"],["3","4"]]')
    assert out == [["1", "2"], ["3", "4"]]


def test_fractions_and_negatives():
    raw = '[["1/2","-3"],["0.5","4"]]'
    assert parse_matrix_response(raw) == [["1/2", "-3"], ["0.5", "4"]]


def test_markdown_fenced():
    raw = "```json\n[[\"1\",\"2\"],[\"3\",\"4\"]]\n```"
    assert parse_matrix_response(raw) == [["1", "2"], ["3", "4"]]


def test_python_style_single_quotes():
    # ast.literal_eval fallback handles single quotes / tuples
    raw = "[['1', '2'], ['3', '4']]"
    assert parse_matrix_response(raw) == [["1", "2"], ["3", "4"]]


def test_bare_numbers_normalized_to_str():
    raw = "[[1, 2], [3, 4]]"
    assert parse_matrix_response(raw) == [["1", "2"], ["3", "4"]]


def test_text_before_and_after_json():
    raw = "Here is the matrix:\n[[\"1\",\"2\"],[\"3\",\"4\"]]\nHope that helps!"
    assert parse_matrix_response(raw) == [["1", "2"], ["3", "4"]]


def test_error_prefix_raises():
    with pytest.raises(PhotoError):
        parse_matrix_response("ERROR: the image is too blurry to read")


def test_non_json_raises():
    with pytest.raises(PhotoError):
        parse_matrix_response("I could not find a matrix in this picture.")


def test_ragged_rows_raise():
    with pytest.raises(PhotoError):
        parse_matrix_response('[["1","2"],["3"]]')


def test_empty_raises():
    with pytest.raises(PhotoError):
        parse_matrix_response("")


def test_prompt_mentions_json_array():
    assert "JSON" in build_prompt()
    assert "array" in build_prompt()

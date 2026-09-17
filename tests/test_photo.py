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


# --- 安全：模型名校验 + Key 走请求头（不放进 URL）------------------------------

def test_model_validation():
    from core.photo import is_valid_model, MODELS
    for m in MODELS:
        assert is_valid_model(m)
    for bad in ["", None, "../../etc/passwd", "x?key=abc", "a b",
                "models/x", "gemini/../secret", "m" * 80]:
        assert not is_valid_model(bad), bad


def test_invalid_model_rejected_without_touching_network(monkeypatch):
    from core import photo

    def boom(*a, **k):
        raise AssertionError("network must not be called for an invalid model")

    monkeypatch.setattr(photo.urllib.request, "urlopen", boom)
    with pytest.raises(photo.PhotoError):
        photo.call_gemini_vision("key", "../../evil", b"x", "image/png")


def test_api_key_travels_in_header_not_url(monkeypatch):
    from core import photo

    seen = {}

    class FakeResp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b'{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}'

    def fake_urlopen(req, timeout=None):
        seen["url"] = req.full_url
        seen["headers"] = {k.lower(): v for k, v in req.header_items()}
        return FakeResp()

    monkeypatch.setattr(photo.urllib.request, "urlopen", fake_urlopen)
    out = photo.call_gemini_vision("SECRET", "gemini-2.5-flash", b"img", "image/png")

    assert out == "hi"
    assert seen["headers"].get("x-goog-api-key") == "SECRET"
    assert "SECRET" not in seen["url"]
    assert "key=" not in seen["url"]

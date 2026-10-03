"""End-to-end: the language the UI is in must be the language the engine speaks.

PR #9 unified the interface but the engine kept emitting hardcoded Chinese, so
the English screen filled up with Chinese derivations. These tests pin the
wiring, not the wording (wording lives in core/i18n.py and is checked by
tools/check_core_i18n.py): what matters is that ``lang`` actually reaches the
step text, and that a caller which forgets it is caught.

The "en output has no CJK" assertions are the load-bearing ones — they are the
only thing here that would notice a missing ``lang=`` at a call site.
"""
import re

import pytest

from core import engine

CJK = re.compile(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]")

A3 = [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]]
SINGULAR = [["1", "2", "3"], ["2", "4", "6"], ["1", "1", "1"]]


def texts(result):
    """Every user-visible string out of a dispatch result."""
    if not result.get("ok"):
        yield result.get("error") or ""
        return
    yield result.get("note") or ""
    for step in result.get("steps") or []:
        yield step.get("text") or ""


def visible(req, lang):
    return [t for t in texts(engine.dispatch(dict(req, lang=lang))) if t.strip()]


# One op per step-producing path, so a lang dropped from any single call site
# shows up rather than being masked by the others.
REQS = [
    {"op": "det_cofactor", "A": A3, "showSteps": True},
    {"op": "det", "A": A3, "showSteps": True},
    {"op": "cofactor_matrix", "A": A3, "showSteps": True},
    {"op": "inverse", "A": A3, "showSteps": True},
    {"op": "left_inverse", "A": A3, "showSteps": True},
    {"op": "ref", "A": A3, "showSteps": True},
    {"op": "lu", "A": A3, "showSteps": True},
    {"op": "solve", "A": [["2", "1"], ["1", "1"]], "B": [["3"], ["2"]],
     "showSteps": True},
    {"op": "multiply", "A": A3},                                # missing B
    {"op": "inverse", "A": SINGULAR, "showSteps": True},        # singular note
    {"expr": "det(A)", "matrices": {"A": A3}, "showSteps": True},
    {"expr": "A**2", "matrices": {"A": A3}},                    # expr error
    {"expr": "foo(A)", "matrices": {"A": A3}},                  # unknown function
]


@pytest.mark.parametrize("req", REQS, ids=lambda r: r.get("op") or r["expr"])
def test_english_output_has_no_chinese(req):
    for text in visible(req, "en"):
        assert not CJK.search(text), f"英文输出里漏了中文: {text!r}"


@pytest.mark.parametrize("req", REQS, ids=lambda r: r.get("op") or r["expr"])
def test_chinese_output_still_chinese(req):
    """The Chinese path must not have been collateral damage."""
    assert visible(req, "zh"), "中文侧没有任何文案，疑似被改坏"


def test_both_languages_differ():
    zh = visible(REQS[0], "zh")
    en = visible(REQS[0], "en")
    assert zh and en and zh != en, "两种语言给出了同一批文案，lang 疑似没生效"


def test_default_is_chinese_without_lang_key():
    """Desktop passes no lang; its behaviour must not change."""
    out = [t for t in texts(engine.dispatch({"op": "det_cofactor", "A": A3,
                                             "showSteps": True})) if t.strip()]
    assert out and any(CJK.search(t) for t in out)


def test_unknown_lang_falls_back_to_chinese():
    out = visible({"op": "det_cofactor", "A": A3, "showSteps": True}, "fr")
    assert out and any(CJK.search(t) for t in out)


def test_same_answer_in_both_languages():
    """Wording may change, the mathematics may not."""
    for lang in ("zh", "en"):
        r = engine.dispatch({"op": "det_cofactor", "A": A3, "lang": lang})
        assert r["value"] == "-15", lang

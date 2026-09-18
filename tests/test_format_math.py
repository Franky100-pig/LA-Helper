"""Tests for the human-readable formula formatter."""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from core import format_math as fm


def test_integer_passthrough():
    assert fm.to_html("2") == "2"
    assert fm.to_html("-7") == "−7"


def test_plain_decimal_passthrough():
    assert fm.to_html("1.618034") == "1.618034"


def test_fraction_stacked():
    out = fm.to_html("3/2")
    assert "frac" in out and '<span class="fnum">3</span>' in out
    assert '<span class="fden">2</span>' in out


def test_negative_fraction():
    out = fm.to_html("-1/2")
    assert out.startswith("−") and "frac" in out


def test_sqrt():
    out = fm.to_html("sqrt(5)")
    assert "√" in out
    assert 'class="rad">5<' in out
    out2 = fm.to_html("sqrt(5)/2")
    assert "√" in out2 and out2.count("frac") == 1


def test_eigen_exact_quadratic():
    # the classic "nobody can read this" case from a 2x2
    out = fm.to_html("(-1 + sqrt(5))/2")
    assert "frac" in out
    assert "√" in out
    assert "5" in out
    assert '<span class="fden">2</span>' in out


def test_cube_root():
    out = fm.to_html("5**(1/3)")
    assert 'class="radix">³' in out and 'class="rad">5<' in out


def test_complex():
    assert fm.to_html("I") == "i"
    assert fm.to_html("-I") == "−i"
    assert fm.to_html("1 + 2*I") == "1 + 2i"


def test_sum_with_radicals():
    out = fm.to_html("1/3 + 5**(1/3)/3")
    assert "frac" in out and 'class="radix">³' in out


def test_fallback_never_raises():
    # garbage should be HTML-escaped, not crash
    out = fm.to_html("not a number @#$")
    assert "&" not in out or "not a number" in out
    assert "<" not in out or "&lt;" in out


def test_step_html_fraction():
    out = fm.step_html("R2 → R2 − (3/2)·R1")
    assert "frac" in out and "·R1" in out


def test_step_html_sqrt():
    out = fm.step_html("R2 → R2 − sqrt(2)·R1")
    assert "√2" in out


def test_step_text_clean():
    assert fm.step_text("R2 → R2 − (3/2)·R1") == "R2 → R2 − (3/2)·R1"


def test_to_text_cleans():
    assert fm.to_text("(-1 + sqrt(5))/2") == "(-1 + √5)/2"
    assert fm.to_text("5**(1/3)") == "5^(1/3)"
    assert fm.to_text("I") == "i"


def test_to_text_decimals():
    assert fm.to_text("1/3", decimals=True) == "0.3333"
    assert fm.to_text("2", decimals=True) == "2"

"""Shared pytest fixtures.

The engine's output language is module-level state (see core/i18n.py for why).
That is fine in production — both editions handle one request at a time — but
in a test suite it means a test that calls ``engine.dispatch(..., lang="en")``
leaves the next test rendering English steps. So reset it before every test.
"""
import pytest

from core import i18n


@pytest.fixture(autouse=True)
def _reset_engine_language():
    i18n.set_lang("zh")
    yield
    i18n.set_lang("zh")

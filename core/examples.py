"""Worked examples for every operation — the shared source of truth.

Two editions ship (tkinter desktop and the static web preview) and they must
never disagree about what a given operation's example looks like. So the data
lives here in ``core/``, next to the engine that has to be able to compute it,
and ``web/examples.js`` is a *copy* that ``tools/test_examples.py`` checks
against this module.

Design notes
------------
* Every example is a matrix that *teaches* something, not a random grid of
  digits. Inverting a matrix that produces fractions is deliberate: it is the
  clearest demonstration of the exact-rational selling point.
* Examples carry their own operands. An operation that needs a second matrix
  gets one, because a half-filled example is a worse first impression than none.
* ``ARTICLES`` maps an operation to the study note that explains it. An
  operation with no honest match simply has no entry — the UI then shows no
  recommendation rather than an irrelevant one. ``det`` is the interesting
  case: the two algorithms deserve two different notes, so it lives in
  ``DET_ARTICLES`` keyed by method.
"""
from . import i18n

# Cells are strings, matching how both UIs store a grid (empty means "0").
# fmt: off
EXAMPLES = {
    # Non-square product: also shows why A×B and B×A differ, and that the
    # engine validates dimensions for you.
    "multiply": {
        "A": [["1", "2", "3"], ["4", "5", "6"]],
        "B": [["7", "8"], ["9", "10"], ["11", "12"]],
        "left": "A", "right": "B",
    },
    "add": {
        "A": [["1", "2"], ["3", "4"]],
        "B": [["5", "6"], ["7", "8"]],
        "left": "A", "right": "B",
    },
    "sub": {
        "A": [["5", "7"], ["9", "11"]],
        "B": [["2", "3"], ["4", "5"]],
        "left": "A", "right": "B",
    },
    # 2x3 transposed into 3x2 makes "swap rows and columns" obvious at a glance.
    "transpose": {
        "A": [["1", "2", "3"], ["4", "5", "6"]],
    },
    # Scalar: the constant lives in the top-left of B, as the UI specifies.
    "scalar": {
        "A": [["1", "2"], ["3", "4"]],
        "B": [["3"]],
        "left": "A", "right": "B",
    },
    # Chosen because the answer is 1/2, not 0.5 — this is the exact-rational
    # selling point in one matrix.
    "inverse": {
        "A": [["1", "1"], ["1", "-1"]],
    },
    # A left inverse needs full column rank (more rows than columns).
    "left_inverse": {
        "A": [["1", "0"], ["0", "1"], ["1", "1"]],
    },
    # A right inverse needs full row rank (fewer rows than columns).
    "right_inverse": {
        "A": [["1", "0", "1"], ["0", "1", "1"]],
    },
    # Deliberately singular: the whole point of a pseudoinverse is that it
    # exists where a real inverse does not.
    "pseudo_inverse": {
        "A": [["1", "2"], ["2", "4"]],
    },
    # Pivoting is visible here: the first column prefers 4 over 1.
    "lu": {
        "A": [["1", "2"], ["4", "3"]],
    },
    # Solves to integers x=1, y=3.
    "solve": {
        "A": [["2", "1"], ["1", "3"]],
        "B": [["5"], ["10"]],
        "left": "A", "right": "B",
    },
    # Row reduction drives the third row to all zeros — linear dependence,
    # visible in one computation.
    "ref": {
        "A": [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]],
    },
    # Contains zeros so cofactor expansion can pick the cheapest row/column.
    "det": {
        "A": [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]],
    },
    # Same matrix as det: the two notes (cofactor, adjugate) cross-reference
    # each other nicely.
    "cofactor_matrix": {
        "A": [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]],
    },
    # Rank 2, not 3.
    "rank": {
        "A": [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]],
    },
    # lambda = 3 and 1 with eigenvectors (1,1) and (1,-1).
    "eigen": {
        "A": [["2", "1"], ["1", "2"]],
    },
}

# One-click "here is a thing worth seeing" scenarios. Each sets the operation
# together with its matrices, because a first-time visitor should not have to
# know which operation demonstrates which idea.
STARTERS = [
    {
        "id": "startSingular",
        "op": "inverse",
        "A": [["1", "2"], ["2", "4"]],
        # This one has no inverse — it lands exactly on "det = 0 means no
        # inverse", and the result panel says why.
    },
    {
        "id": "startCofactor",
        "op": "det",
        "detMethod": "cofactor",
        "A": [["2", "0", "1"], ["1", "3", "2"], ["4", "1", "0"]],
    },
    {
        "id": "startSolve",
        "op": "solve",
        "A": [["2", "1"], ["1", "3"]],
        "B": [["5"], ["10"]],
        "left": "A", "right": "B",
    },
]

# operation -> (note id, title). Titles are duplicated in web/examples.js and
# in notes.js; tools/test_examples.py asserts all three agree so they cannot
# drift. Desktop shows only the id (it opens the note in a browser).
ARTICLES = {
    "multiply": ("matmul", "note.matmul"),
    "inverse": ("singular", "note.det_zero"),
    "left_inverse": ("rank", "note.rank"),
    "right_inverse": ("rank", "note.rank"),
    "pseudo_inverse": ("rank", "note.rank"),
    "lu": ("row-reduction", "note.row_reduction"),
    "solve": ("row-reduction", "note.row_reduction"),
    "ref": ("row-reduction", "note.row_reduction"),
    "cofactor_matrix": ("adjugate", "note.adjugate"),
    "rank": ("rank", "note.rank"),
    "eigen": ("eigen", "note.eigen"),
}

# det is keyed by method: the two algorithms deserve two different notes.
DET_ARTICLES = {
    "row_reduction": ("row-reduction", "note.row_reduction"),
    "cofactor": ("cofactor", "note.cofactor"),
}
# fmt: on

# Operations that take a second matrix. Mirrors OPS_NEED_B in both UIs.
OPS_NEED_B = {"multiply", "add", "sub", "solve", "scalar"}


def example_for(op):
    """Worked example for ``op``, or None if the operation has none."""
    return EXAMPLES.get(op)


def article_for(op, det_method="row_reduction"):
    """(note id, title) for ``op``, or None when nothing honest applies.

    Returning None is a normal outcome: the caller shows no recommendation.

    The title comes back already resolved to one language, so callers keep the
    plain ``(id, title)`` shape they had before titles became bilingual.
    """
    art = DET_ARTICLES.get(det_method) if op == "det" else ARTICLES.get(op)
    if not art:
        return None
    note_id, title_key = art
    return note_id, i18n.tr(title_key)


def article_pairs():
    """``{key: (note id, {"zh":…, "en":…})}`` for the cross-language checks.

    Only tools/test_examples.py needs this: it asserts that core, web/examples.js
    and notes.js all carry the same titles in *both* languages. Returning the
    raw keys instead would just move the failure to "somebody forgot to call
    tr()".
    """
    out = {}
    for k, (note_id, title_key) in ARTICLES.items():
        out[k] = (note_id, {lang: i18n.tr(title_key, _lang=lang)
                            for lang in ("zh", "en")})
    for k, (note_id, title_key) in DET_ARTICLES.items():
        out[f"det:{k}"] = (note_id, {lang: i18n.tr(title_key, _lang=lang)
                                     for lang in ("zh", "en")})
    return out

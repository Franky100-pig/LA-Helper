# LA Helper · A Local Linear Algebra Study Calculator

[English](README.en.md) | [中文](README.md)

An open-source tool that runs **100% locally**, built so that while studying
linear algebra you "not only get the answer, but can follow the process".
Every matrix operation uses SymPy **exact rationals**, so `1/3` never becomes
`0.333`.

All three editions share the same `core/` engine and produce identical results.
Just pick the one that fits your workflow:

| Edition | Best for | How to use |
|---|---|---|
| 🖥 **Desktop** | Everyday homework; double-click and go | Download an installer from [Releases](https://github.com/Franky100-pig/LA-Helper/releases) — no Python, no internet |
| 🌐 **Web (local)** | You already have Python and want to tweak the code | `python web/app.py` — opens your browser |
| ☁️ **Online preview** | Demoing on a classmate's laptop or a phone | Open <https://27f263035b214ac598c05e6f0dc76cff.app.workbuddy.host> — real Python running in the browser |

## Features
- Matrix input / display, transpose, addition, subtraction, **scalar multiplication**
- **Matrix multiplication** (automatic dimension checking, up to 16×16)
- **Square-matrix inverse** (Gauss-Jordan, with steps)
- **Left / right inverse** (given when full column / row rank; explains why when it is not)
- **Moore-Penrose pseudo-inverse** (general)
- **LU decomposition** (with partial pivoting, PA = LU, with steps)
- **Augmented-matrix solve** ([A|b] → RREF; unique / no solution / infinitely many, plus a null-space basis)
- **Determinant, rank, REF (row echelon form)** (RREF is used internally by solve / inverse)
- **Eigenvalues / eigenvectors** (exact for small matrices; ≥5×5 switches to a numerical solver automatically, avoiding `CRootOf` and long stalls)
- Every operation can toggle **"show steps"** and **decimal display**
- **Import a matrix from a photo** (desktop + web / online preview): take a picture of a
  matrix (or a screenshot), have Google Gemini's vision model read it into numbers, and it
  is filled into the editor grid — just double-check it afterwards (a misread digit can
  always be corrected by hand)

## How to use it (two ways, identical results)

**① Operation dropdown** (the main path, available in all three editions) — choose
the operation + left operand + right operand, then press Compute.

**② Expression shortcuts** (available in all three editions) — write it on one line,
press Enter, done:

```
inv(A) * B - C        det(A * B)        3 * inv(A)        A^2        A^-1
```

Open the "shortcut guide" in the UI for the full table (each row also shows the
dropdown operation it corresponds to). Supported: `+ - *`, `/ scalar`, `^n`, and
`inv` `det` `rank` `ref` `T`/`transpose` `pinv` `lu` `solve` `eigen` (the last three
return more than one item, so they must be used on their own).

> The expression path is not a second implementation: both paths go through
> `engine.dispatch` into the same underlying code, so even the calculation steps
> come out byte-for-byte identical.

### Matrix library and input

| Capability | Web / online preview | Desktop |
|---|:--:|:--:|
| Resize without losing data | ✅ | ✅ |
| Named matrix library (add / rename / delete) | ✅ | ✅ |
| Expression shortcuts | ✅ | ✅ |
| Live side preview | ✅ | ✅ |
| Paste detection (a run of numbers becomes a matrix) | ✅ | ✅ |
| Quick single-cell editing (focus selects all / `Esc` reverts) | ✅ | — |
| Import from a photo (Gemini vision) | ✅ | ✅ |

- **Named matrices**: four empty slots (A, B, C, D) by default; add / rename /
  delete them and refer to them by name in expressions.
- **Resize without losing data**: turn a 3×3 into a 3×4 and the nine values you
  already typed stay in place (new cells are left empty, dropped cells are discarded).
- **Paste to import**: `Ctrl+V` straight from Excel or any text.
  - Tabular text with newlines → imported in its original shape;
  - A whitespace-separated run of numbers → columns are derived from the "rows" you
    already set (3 rows + 12 numbers → 3×4);
  - A single number → fills only the current cell.
- The **live side preview** shows the numbers the engine will *actually* use; `0`s
  filled in automatically are greyed out, so you can see at a glance which cells are
  still empty.
- **Quick single-cell editing**: clicking a cell selects its contents, so typing
  replaces them; `Esc` reverts that cell. Enter / arrow keys move between cells in
  row-major order.
- An empty cell counts as **0**.

- **Import a matrix from a photo** (desktop / web): click "Import from image", pick a
  photo or screenshot of a matrix, and the tool uses Google's **Gemini vision model**
  (free tier; get a key at `aistudio.google.com`) to read it into numbers, then fills
  the grid you are editing. **Always double-check the result** — the model occasionally
  misreads a digit, and you can edit it in the grid afterwards.
  - **The API key stays on your own machine**: on desktop it is written to
    `~/.la_helper_settings.json`, on the web to browser `localStorage`. Nothing is
    uploaded to any server; it is sent straight to Gemini only when you make the request.
  - Parsing uses **the same Python code** as the desktop edition
    (`core.photo.parse_matrix_response`), so both editions read a photo identically;
    when the model's reply cannot be parsed, the UI shows the raw text so you can copy
    it by hand.

---

## 🖥 Desktop (recommended for daily use)

A native window app: no browser, no internet, no Python install required.

### Direct download

Grab the archive for your operating system from the
[Releases](https://github.com/Franky100-pig/LA-Helper/releases) page:

| Your OS | File | First launch |
|---|---|---|
| macOS (Apple silicon / M-series) | `LA-Helper-macOS-arm64.zip` | Unzip, then **right-click → Open** (the build is unsigned, so a plain double-click is blocked by Gatekeeper) |
| Windows 10 / 11 (64-bit) | `LA-Helper-Windows-x64.zip` | Unzip and run `LA Helper.exe`; when SmartScreen warns, choose "More info → Run anyway" |

> Intel-based Mac users should use "Run from source" below, or run
> `bash desktop/build_mac.sh` themselves.

### Run from source

```bash
pip install sympy
python desktop/app.py
```

### Build it yourself

```bash
bash desktop/build_mac.sh      # macOS → dist/LA Helper.app
.\desktop\build_win.ps1        # Windows (PowerShell) → dist\LA Helper\LA Helper.exe
```

A Windows `.exe` **cannot be cross-compiled on macOS** — the script must run on a
Windows machine. If you don't have one, just push a `v*` tag and this repository's
[release pipeline](.github/workflows/release.yml) will build installers for both
platforms on GitHub.

---

## 🌐 Web edition

```bash
pip install -r requirements.txt
python web/app.py        # opens your browser at http://127.0.0.1:8000
```

No internet, no account. Optional flags: `--port 8123`, `--no-browser`, `--verbose`.
If the port is already taken it automatically moves on to the next free one.

## Input rules
Cells accept **integers, decimals and fractions** (`1/3`, `-2`, `0.5`, `1e-3`).
Anything unrecognised raises a clear error instead of being silently treated as a
variable, and no expression is ever executed (an input like `9**9**9`, which would
hang the service, is rejected).

---

## Project layout
```
la-helper/
├── core/          # pure algorithm layer (exact rationals, zero GUI/web deps, fully unit-tested)
│                  #   engine.py is the single dispatch entry point; expr.py is the expression parser
├── web/           # web edition: app.py serves + index.html / app.js
├── desktop/       # desktop edition: tkinter GUI + packaging scripts for both platforms
├── tools/         # build_preview.py: bundles core/ into a Pyodide static preview
└── tests/         # pytest, TDD red-green-refactor
```
- Algorithms and UI are decoupled: `core` only computes, `web` / `desktop` only present.
- Values are exact fractions by default; tick "decimal display" to switch to
  4-decimal approximations.

## Tests
```bash
pip install -r requirements-dev.txt
pytest
```
Coverage: each `core` module, the `core.engine` contract, `core.expr` expressions
(including assertions that they are equivalent to the dropdown path, and rejection
cases such as `9**9**9`), plus regression cases for input safety, singular matrices,
symbolic matrices and large matrices.

## Security boundaries
The web edition only listens on `127.0.0.1`; it is not a service meant for the public
internet — do not expose it to your LAN or put it behind a reverse proxy. All matrix
computation happens inside the local process / browser sandbox and **sends no data**.

**Two exceptions, both triggered by you and both entirely avoidable:**

1. **Importing from a photo.** When you click "Import from image", that image is sent
   directly to the Gemini (Google) API you configured for recognition. The API key is
   stored only on your machine and is sent to Google only with that request, through
   the `x-goog-api-key` header — it never passes through any third-party server and is
   never written into a URL.
2. **AI Help (web edition).** When you ask a question on the AI Help page, the question
   you typed (plus a fixed system prompt) is sent to the GLM (Zhipu) API you configured.
   The GLM key lives only in your browser's `localStorage` and goes straight to
   `open.bigmodel.cn` in an `Authorization` header — no intermediary server involved.

If you would rather not make any network call, simply don't use these two buttons;
every other feature remains fully offline.

## Roadmap
- [ ] More factorisations (QR / SVD), Gram-Schmidt, least squares
- [ ] Structured steps (per-step matrix snapshot and current pivot, with step-through / highlighting)
- [x] Import a matrix from a photo (Gemini vision, desktop + web)
- [ ] Optional "partial pivoting" strategy for REF, defaulting to the textbook presentation

"""Photo -> matrix: read a matrix from an image via an LLM vision API.

The only genuinely free, keyless vision API we found is Google's Gemini
(2.5 Flash) free tier, obtained at https://aistudio.google.com. The provider
is abstracted behind :func:`call_vision` so a future Claude/OpenAI backend can
be slotted in without touching the UI.

Two consumers:
* Desktop (CPython): calls the API directly via :func:`image_to_matrix`.
* Web (Pyodide): the browser does the fetch (to avoid Pyodide CORS issues) and
  then hands the raw text to :func:`parse_matrix_response`, which is pure and
  runs identically in both environments.

In every path the parsed matrix is meant to land in the *editable* grid so the
user can verify/fix a digit the model misread.
"""
import ast
import base64
import json
import re
import urllib.request

DEFAULT_MODEL = "gemini-2.5-flash"
GEMINI_ENDPOINT = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}"
    ":generateContent"
)

# Supported image MIME types (Gemini accepts these for inline_data).
SUPPORTED_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".heic": "image/heic",
}


class PhotoError(Exception):
    """Raised when the image -> matrix pipeline fails.

    ``raw`` carries the model's raw text (or an error message) so the UI can
    show it to the user for a manual fix.
    """

    def __init__(self, message, raw=""):
        super().__init__(message)
        self.raw = raw


def build_prompt():
    """Instruction text sent alongside the image."""
    return (
        "This image shows a single matrix (a rectangular array of numbers). "
        "Read it and output ONLY a JSON array of arrays of strings, one inner "
        "array per row, e.g. [[\"1\",\"2\"],[\"3\",\"4\"]]. Rules: keep each "
        "entry exactly as written — fractions as \"a/b\", negatives with a "
        "minus sign, decimals as written; do not simplify or evaluate. The "
        "array must be rectangular (every row the same length). If you cannot "
        "read the matrix clearly, output the word ERROR followed by what you "
        "see instead of a JSON array."
    )


def parse_matrix_response(text):
    """Turn a model's text reply into a 2D list of strings.

    Tolerant of markdown code fences and of Python-style literals. Raises
    :class:`PhotoError` (with ``raw`` set) if nothing parseable is found.
    """
    raw = (text or "").strip()
    if not raw:
        raise PhotoError("模型返回为空。", raw=raw)
    if raw.upper().startswith("ERROR"):
        raise PhotoError(raw, raw=raw)

    # Strip a markdown code fence if present.
    fenced = re.search(r"```(?:json)?\s*(.*?)```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1).strip()

    data = None
    candidates = [raw]
    s, e = raw.find("["), raw.rfind("]")
    if s != -1 and e != -1 and e > s:
        candidates.append(raw[s:e + 1])
    for cand in candidates:
        if not cand:
            continue
        try:
            data = json.loads(cand)
            break
        except Exception:
            pass
        try:
            data = ast.literal_eval(cand)
            break
        except Exception:
            pass

    if data is None or not isinstance(data, list) or not data:
        raise PhotoError(f"无法从模型返回中解析出矩阵：\n{text}", raw=text)

    rows = []
    width = None
    for r in data:
        if not isinstance(r, (list, tuple)):
            raise PhotoError(
                f"返回不是矩形数组（某行不是列表）：{r!r}", raw=text)
        cells = [str(c) for c in r]
        if width is None:
            width = len(cells)
        elif len(cells) != width:
            raise PhotoError(
                f"各行长度不一致（期望 {width}，实际 {len(cells)}）：{cells}",
                raw=text)
        rows.append(cells)
    return rows


def call_gemini_vision(api_key, model, image_bytes, mime, prompt=None):
    """Call Gemini vision and return the raw text reply (desktop path)."""
    if not api_key:
        raise PhotoError("未配置 Gemini API Key。请在设置中填入。")
    url = GEMINI_ENDPOINT.format(model=model) + f"?key={api_key}"
    body = {
        "contents": [{
            "parts": [
                {"text": prompt or build_prompt()},
                {"inline_data": {
                    "mime_type": mime,
                    "data": base64.b64encode(image_bytes).decode("ascii"),
                }},
            ]
        }],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0,
        },
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:500]
        raise PhotoError(f"Gemini API 返回错误 {exc.code}：{detail}", raw=detail)
    except Exception as exc:  # network / timeout / JSON
        raise PhotoError(f"调用 Gemini 失败：{exc}", raw=str(exc))

    try:
        return payload["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        raise PhotoError("Gemini 返回格式异常。", raw=json.dumps(payload)[:500])


def image_to_matrix(api_key, model, image_bytes, mime, prompt=None):
    """Full desktop pipeline: image bytes -> (matrix, raw_text).

    ``matrix`` is a list of lists of strings (ready for the editable grid).
    ``raw_text`` is the model's raw reply, useful when parsing fails.
    """
    raw = call_gemini_vision(api_key, model, image_bytes, mime, prompt)
    matrix = parse_matrix_response(raw)
    return matrix, raw

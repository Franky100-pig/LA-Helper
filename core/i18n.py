"""Bilingual user-facing text for the engine.

The engine's output — the step-by-step derivations, the error messages, the
notes under a result — is what a student actually reads. PR #9 unified the
*interface* (buttons, headings, the tab title) but left every one of these
strings a hardcoded Chinese literal, so the English interface produced Chinese
derivations. This module is the other half.

Why a module-level language instead of a ``lang`` parameter
----------------------------------------------------------
The strings sit three to four calls deep (engine -> det_rank -> format_math),
and they are produced inside loops and recursive helpers. Threading ``lang``
through would touch every signature, every call site and every caller (the
Pyodide bridge, the local server, the desktop app) for no behavioural gain.
A module global set once per request matches how ``web/i18n.js`` already works
on the other side of the same boundary.

Consequences, stated plainly:

* **Not thread-safe.** Both editions handle one request at a time in a single
  thread, and :func:`set_lang` is called at the top of ``dispatch`` before any
  work happens. A future server that threads requests would need a
  context-local instead — the day it needs one, this is the only line to change.
* The desktop app has no language switcher, so it keeps the default ``zh`` and
  its behaviour is unchanged.

Fallbacks, in order: requested language -> ``zh`` -> the key itself. A missing
translation therefore degrades to Chinese rather than to an empty bubble or a
KeyError, which is the same policy ``web/i18n.js`` uses.
"""

DEFAULT_LANG = "zh"
FALLBACK_LANG = "zh"

_LANG = DEFAULT_LANG


def set_lang(lang):
    """Switch the engine's output language. Unknown values fall back to zh."""
    global _LANG
    _LANG = lang if lang in ("zh", "en") else FALLBACK_LANG
    return _LANG


def get_lang():
    """The language steps and errors are currently rendered in."""
    return _LANG


# ---------------------------------------------------------------------------
# Message catalogue
# ---------------------------------------------------------------------------
# Keys are dotted by module so a grep for "who says this" lands in one place.
# Placeholders are str.format fields; keep them identical in both languages
# (tools/test_core_i18n.py checks that), otherwise one of the two crashes.
MESSAGES = {
    # --- matrix.py: cell / matrix parsing -----------------------------------
    "err.matrix.exp_absurd": {
        "zh": "指数过大 {s}：绝对值上限 {limit}（避免生成天文数字，正常矩阵用不到这么大的量级）",
        "en": "Exponent too large in {s}: the absolute limit is {limit} (this avoids astronomically big numbers; ordinary matrices never need one)",
    },
    "err.matrix.cell_empty": {
        "zh": "单元格为空，请填 0 或删除该行/列",
        "en": "This cell is empty — enter 0, or delete the row/column",
    },
    "err.matrix.cell_too_long": {
        "zh": "单元格内容过长（>{limit} 字符）：{preview}…",
        "en": "Cell content too long (>{limit} characters): {preview}…",
    },
    "err.matrix.zero_denominator": {
        "zh": "分母不能为 0：{s}",
        "en": "Denominator cannot be 0: {s}",
    },
    "err.matrix.cell_unrecognized": {
        "zh": "无法识别的输入 {s}；仅支持整数、小数、分数（如 1/3）{extra}",
        "en": "Cannot read {s}; only integers, decimals and fractions (e.g. 1/3) are supported{extra}",
    },
    # Appended to the message above when the matrix library allows symbols.
    # English needs the leading space, Chinese does not.
    "err.matrix.symbols_suffix": {
        "zh": "或单个字母变量",
        "en": " or a single letter",
    },
    "err.matrix.not_rows": {
        "zh": "矩阵需要是「行」的列表，收到 {got}",
        "en": "A matrix must be a list of rows; got {got}",
    },
    "err.matrix.row_not_cells": {
        "zh": "第 {row} 行需要是「元素」的列表，收到 {got}",
        "en": "Row {row} must be a list of cells; got {got}",
    },
    "err.matrix.ragged_row": {
        "zh": "row {row} 的长度是 {length}，应为 {expected}",
        "en": "row {row} has length {length}, expected {expected}",
    },

    # --- engine.py: request-level validation and errors ----------------------
    "err.engine.bad_request": {
        "zh": "请求格式不对",
        "en": "Malformed request",
    },
    "err.engine.parse": {
        "zh": "矩阵 {name} 输入有误：{detail}",
        "en": "Matrix {name} is invalid: {detail}",
    },
    "err.engine.empty": {
        "zh": "矩阵 {name} 为空，请至少填写一个元素",
        "en": "Matrix {name} is empty — enter at least one cell",
    },
    "err.engine.too_big": {
        "zh": "矩阵 {name} 是 {rows}×{cols}，超过上限 {limit}×{limit}",
        "en": "Matrix {name} is {rows}×{cols}, over the {limit}×{limit} limit",
    },
    "err.engine.needs_b": {
        "zh": "这个运算需要第二个矩阵 B",
        "en": "This operation needs a second matrix B",
    },
    "err.engine.scalar_needs_1x1": {
        "zh": "标量乘法需要在 B 中填 1×1 的常数（把 B 设成 1 行 1 列）",
        "en": "Scalar multiplication needs a 1×1 constant in B (set B to 1 row, 1 column)",
    },
    "err.engine.inverse_needs_square": {
        "zh": "求逆需要方阵，收到 {rows}×{cols}",
        "en": "Inverse needs a square matrix, got {rows}×{cols}",
    },
    "err.engine.unknown_op": {
        "zh": "未知运算：{op}",
        "en": "Unknown operation: {op}",
    },
    "note.engine.det_zero": {
        "zh": "det(A) = 0：A 奇异，所以 A⁻¹ 不存在",
        "en": "det(A) = 0: A is singular, so A⁻¹ does not exist",
    },

    # --- transform.py: applying T(x) = A·x -----------------------------------
    "err.transform.needs_vector": {
        "zh": "x 必须是一个向量：收到 {rows}×{cols} 的矩阵（请填 n×1，或 1×n）",
        "en": "x must be a vector: got a {rows}×{cols} matrix (enter n×1, or 1×n)",
    },
    "err.transform.dim": {
        "zh": "维数不匹配：A 是 {ar}×{ac}，x 有 {xr} 个分量（需要 {ac} 个）",
        "en": "Dimension mismatch: A is {ar}×{ac} but x has {xr} components (expected {ac})",
    },
    "transform.intro": {
        "zh": "T(x) = A·x：把 A 的每一行与 x 做点积，逐个得到输出的分量",
        "en": "T(x) = A·x: take the dot product of each row of A with x to get each output component",
    },
    "transform.component": {
        "zh": "y{i} = 第 {i} 行 · x = {expr} = {value}",
        "en": "y{i} = row {i} · x = {expr} = {value}",
    },
    "transform.done": {
        "zh": "所以 T(x) 就是上面这个向量",
        "en": "So T(x) is the vector shown above",
    },

    # --- det_rank.py: determinants and ranks ---------------------------------
    "det.lu_factor": {
        "zh": "由 P·A = L·U 得 det(A) = det(P)·det(L)·det(U)",
        "en": "From P·A = L·U: det(A) = det(P)·det(L)·det(U)",
    },
    "det.zero_pivot": {
        "zh": "消元时出现了零主元 → 矩阵奇异（不可逆）",
        "en": "Elimination hit a zero pivot → A is singular (not invertible)",
    },
    "det.zero": {
        "zh": "det(A) = 0，矩阵奇异",
        "en": "det(A) = 0, so A is singular",
    },
    "det.value": {
        "zh": "det(A) = {value}",
        "en": "det(A) = {value}",
    },
    "det.cofactor.row_head": {
        "zh": "{pad}沿第 {index} 行展开（该行 0 最多）："
              "det = Σⱼ (−1)^({index}+j)·a({index},j)·M({index},j)",
        "en": "{pad}Expand along row {index} (it has the most zeros): "
              "det = Σⱼ (−1)^({index}+j)·a({index},j)·M({index},j)",
    },
    "det.cofactor.col_head": {
        "zh": "{pad}沿第 {index} 列展开（该列 0 最多）："
              "det = Σᵢ (−1)^(i+{index})·a(i,{index})·M(i,{index})",
        "en": "{pad}Expand along column {index} (it has the most zeros): "
              "det = Σᵢ (−1)^(i+{index})·a(i,{index})·M(i,{index})",
    },
    "det.cofactor.term": {
        "zh": "{pad}项 ({row},{col})：系数 (−1)^({row}+{col})·a({row},{col}) "
              "= {coef}，余子式 M({row},{col}) 见下"
              "（去掉第 {row} 行、第 {col} 列）",
        "en": "{pad}Term ({row},{col}): coefficient (−1)^({row}+{col})·a({row},{col}) "
              "= {coef}; the minor M({row},{col}) is below "
              "(row {row} and column {col} deleted)",
    },
    "det.cofactor.level_total": {
        "zh": "{pad}⇒ 本层行列式 = {total}",
        "en": "{pad}⇒ determinant at this level = {total}",
    },
    "det.cofactor.one_by_one": {
        "zh": "1×1 矩阵：det(A) = a(1,1) = {value}",
        "en": "1×1 matrix: det(A) = a(1,1) = {value}",
    },
    "err.det.cofactor_too_big": {
        "zh": "代数余子式展开最多支持 {limit}×{limit}"
              "（当前 {rows}×{cols}）；这么大的矩阵请改用「行变换法」",
        "en": "Cofactor expansion supports at most {limit}×{limit} "
              "(this one is {rows}×{cols}); use row reduction for a matrix this size",
    },
    "err.det.cofactor_matrix_needs_square": {
        "zh": "余子式矩阵需要方阵，收到 {shape}",
        "en": "The cofactor matrix needs a square matrix; got {shape}",
    },
    "err.det.cofactor_matrix_too_big": {
        "zh": "余子式矩阵最多支持 {limit}×{limit}"
              "（当前 {rows}×{cols}）；这么大的矩阵建议改用「方阵求逆 A⁻¹」",
        "en": "The cofactor matrix supports at most {limit}×{limit} "
              "(this one is {rows}×{cols}); use inverse A⁻¹ for a matrix this size",
    },
    "det.cofactor_matrix.entry": {
        "zh": "C({row},{col}) = (−1)^({row}+{col}) · "
              "det(划掉第 {row} 行第 {col} 列) = {sign} · {minor} = {value}",
        "en": "C({row},{col}) = (−1)^({row}+{col}) · "
              "det(row {row} and column {col} deleted) = {sign} · {minor} = {value}",
    },
    "det.cofactor_matrix.done": {
        "zh": "余子式矩阵 C 已求出（见上）。伴随矩阵 adj(A) = Cᵀ；"
              "当 det(A) ≠ 0 时 A⁻¹ = adj(A)/det(A)。",
        "en": "The cofactor matrix C is done (above). The adjugate adj(A) = Cᵀ; "
              "when det(A) ≠ 0, A⁻¹ = adj(A)/det(A).",
    },

    # --- expr.py: the expression box ----------------------------------------
    "err.expr.too_long": {
        "zh": "表达式过长（超过 {limit} 字符）",
        "en": "Expression too long (over {limit} characters)",
    },
    "err.expr.unknown_name": {
        "zh": "位置 {pos}：不认识的名称 {name}",
        "en": "Position {pos}: unknown name {name}",
    },
    "err.expr.double_star": {
        "zh": "位置 {pos}：幂运算请用单个 ^（例如 A^2），不支持 **",
        "en": "Position {pos}: use a single ^ for powers (e.g. A^2); ** is not supported",
    },
    "err.expr.bad_char": {
        "zh": "位置 {pos}：无法识别的字符 {char}",
        "en": "Position {pos}: cannot read the character {char}",
    },
    "err.expr.expected_op": {
        "zh": "位置 {pos}：应为 {op}，实际是 {got}",
        "en": "Position {pos}: expected {op}, got {got}",
    },
    # "got" when the parser reached the end of the input
    "err.expr.end_of_input": {
        "zh": "表达式末尾",
        "en": "the end of the expression",
    },
    "err.expr.trailing": {
        "zh": "位置 {pos}：多余的 {token}",
        "en": "Position {pos}: unexpected {token}",
    },
    "err.expr.too_deep": {
        "zh": "表达式嵌套过深（超过 {limit} 层）",
        "en": "Expression nests too deeply (over {limit} levels)",
    },
    "err.expr.incomplete": {
        "zh": "表达式不完整：末尾还缺一个操作数",
        "en": "Expression is incomplete: it ends with an operand missing",
    },
    "err.expr.unexpected": {
        "zh": "位置 {pos}：意外的 {token}",
        "en": "Position {pos}: unexpected {token}",
    },
    "err.expr.arity": {
        "zh": "函数 {name} 需要 {want} 个参数，收到 {got} 个",
        "en": "Function {name} takes {want} argument(s), got {got}",
    },
    "err.expr.unknown_matrix": {
        "zh": "未知矩阵 {name}（当前矩阵库：{have}）",
        "en": "Unknown matrix {name} (current matrix library: {have})",
    },
    # Joined into the message above; the separator is language-specific.
    "err.expr.list_separator": {
        "zh": "、",
        "en": ", ",
    },
    "err.expr.library_empty": {
        "zh": "空",
        "en": "empty",
    },
    "err.expr.matrix_too_big": {
        "zh": "矩阵 {name} 是 {rows}×{cols}，超过上限 {limit}×{limit}",
        "en": "Matrix {name} is {rows}×{cols}, over the {limit}×{limit} limit",
    },
    "err.expr.unknown_function": {
        "zh": "未知函数 {name}",
        "en": "Unknown function {name}",
    },
    "err.expr.poly_result": {
        "zh": "函数 {name} 的结果是多项，只能单独使用，不能参与计算",
        "en": "The result of {name} is a polynomial; it can only be used on its own, "
              "not inside a calculation",
    },
    "err.expr.add_mixed": {
        "zh": "不能把矩阵和标量相加",
        "en": "Cannot add a matrix and a scalar",
    },
    "err.expr.sub_mixed": {
        "zh": "不能把矩阵和标量相减",
        "en": "Cannot subtract a scalar from a matrix",
    },
    "err.expr.matrix_div": {
        "zh": "不支持矩阵除法；若要算 A 乘 B 的逆，请写 A * inv(B)",
        "en": "Matrix division is not supported; to multiply A by the inverse of B, write A * inv(B)",
    },
    "err.expr.pow_matrix": {
        "zh": "幂指数不能是矩阵；请写整数，如 A^2、A^-1",
        "en": "The exponent cannot be a matrix; write an integer, e.g. A^2, A^-1",
    },
    "err.expr.pow_not_int": {
        "zh": "幂指数必须是整数（如 A^2、A^-1）",
        "en": "The exponent must be an integer (e.g. A^2, A^-1)",
    },
    "err.expr.pow_too_big": {
        "zh": "幂指数过大（上限 {limit}）",
        "en": "Exponent too large (limit {limit})",
    },
    "err.expr.bad_operator": {
        "zh": "不支持的运算符 {op}",
        "en": "Unsupported operator {op}",
    },
    "err.expr.needs_matrix": {
        "zh": "{where} 需要矩阵参数，实际收到标量",
        "en": "{where} needs a matrix argument, but got a scalar",
    },

    # --- photo.py: image import ----------------------------------------------
    "err.photo.empty_reply": {
        "zh": "模型返回为空。",
        "en": "The model returned nothing.",
    },
    "err.photo.unparsable": {
        "zh": "无法从模型返回中解析出矩阵：\n{text}",
        "en": "No matrix could be parsed out of the model reply:\n{text}",
    },
    "err.photo.not_rectangular": {
        "zh": "返回不是矩形数组（某行不是列表）：{row}",
        "en": "The reply is not a rectangular array (one row is not a list): {row}",
    },
    "err.photo.ragged": {
        "zh": "各行长度不一致（期望 {expected}，实际 {got}）：{cells}",
        "en": "Rows have different lengths (expected {expected}, got {got}): {cells}",
    },
    "err.photo.no_key": {
        "zh": "未配置 Gemini API Key。请在设置中填入。",
        "en": "No Gemini API key configured. Add one in Settings.",
    },
    "err.photo.bad_model": {
        "zh": "模型名不合法：{model}（只允许字母、数字、. _ -）",
        "en": "Invalid model name: {model} (only letters, digits, . _ - are allowed)",
    },
    "err.photo.api_error": {
        "zh": "Gemini API 返回错误 {code}：{detail}",
        "en": "Gemini API returned error {code}: {detail}",
    },
    "err.photo.call_failed": {
        "zh": "调用 Gemini 失败：{detail}",
        "en": "Calling Gemini failed: {detail}",
    },
    "err.photo.bad_shape": {
        "zh": "Gemini 返回格式异常。",
        "en": "Gemini returned an unexpected shape.",
    },

    # --- solve.py / lu.py / inverse.py: the row operations themselves -------
    # These used to be hardcoded **English**, which is why the Chinese UI
    # showed "Swap R1 ↔ R2" in the middle of an otherwise Chinese derivation.
    # The bilingual pass only banned Chinese, so nothing caught them.
    "eigen.step.char_matrix": {
        "zh": "构造特征矩阵 A − λI",
        "en": "Construct characteristic matrix A − λI",
    },
    "eigen.step.char_poly": {
        "zh": "计算特征多项式：p(λ) = det(A − λI) = {poly} = 0",
        "en": "Characteristic polynomial: p(λ) = det(A − λI) = {poly} = 0",
    },
    "eigen.step.char_poly_factored": {
        "zh": "特征多项式因式分解：p(λ) = {factored} = 0",
        "en": "Factored characteristic polynomial: p(λ) = {factored} = 0",
    },
    "eigen.step.eigenvalues": {
        "zh": "特征值根及代数重数 (AM)：{roots}",
        "en": "Eigenvalue roots and algebraic multiplicities (AM): {roots}",
    },
    "eigen.step.eigenspace": {
        "zh": "对特征值 λ = {val}，解方程 (A − λI)v = 0（代数重数 AM = {mult}）",
        "en": "For eigenvalue λ = {val}, solve (A − λI)v = 0 (algebraic multiplicity AM = {mult})",
    },
    "eigen.step.eigenspace_basis": {
        "zh": "特征向量基（几何重数 GM = {geom}）：{vectors}",
        "en": "Eigenvector basis (geometric multiplicity GM = {geom}): {vectors}",
    },
    "eigen.step.defective": {
        "zh": "特征值 λ = {val} 几何重数亏损：GM = {geom} < AM = {mult}（不可对角化）",
        "en": "Eigenvalue λ = {val} is defective: GM = {geom} < AM = {mult} (not diagonalizable)",
    },
    "eigen.diag.success": {
        "zh": "所有特征值几何重数之和等于矩阵阶数（{sum_gm} = {n}），矩阵可对角化",
        "en": "Sum of geometric multiplicities equals matrix dimension ({sum_gm} = {n}); matrix is diagonalizable",
    },
    "eigen.diag.pd": {
        "zh": "构造特征向量矩阵 P 与对角矩阵 D",
        "en": "Construct eigenvector matrix P and diagonal matrix D",
    },
    "eigen.diag.verify": {
        "zh": "计算 P⁻¹ 并验证对角化关系：A = P·D·P⁻¹",
        "en": "Compute P⁻¹ and verify diagonalization: A = P·D·P⁻¹",
    },
    "eigen.diag.fail": {
        "zh": "几何重数之和为 {sum_gm} < {n}，特征值存在几何重数亏损，矩阵不可对角化",
        "en": "Sum of geometric multiplicities is {sum_gm} < {n}; matrix is defective and not diagonalizable",
    },
    "eigen.diag.title": {
        "zh": "对角化 A = P·D·P⁻¹",
        "en": "Diagonalization A = P·D·P⁻¹",
    },
    "eigen.diag.not_diagonalizable": {
        "zh": "不可对角化（特征向量不足以张成整个空间）",
        "en": "Not diagonalizable (eigenvectors do not span the space)",
    },
    "step.swap": {
        "zh": "交换 R{a} ↔ R{b}",
        "en": "Swap R{a} ↔ R{b}",
    },
    "step.swap_pivot": {
        "zh": "交换 R{a} ↔ R{b}（选主元）",
        "en": "Swap R{a} ↔ R{b} (partial pivoting)",
    },
    "step.scale": {
        "zh": "R{a} ← R{a} ÷ {value}",
        "en": "R{a} ← R{a} ÷ {value}",
    },
    "step.scale_neg": {
        "zh": "R{a} ← −R{a}",
        "en": "R{a} ← −R{a}",
    },
    "step.eliminate": {
        "zh": "R{a} ← R{a} − {factor}·R{b}",
        "en": "R{a} ← R{a} − {factor}·R{b}",
    },
    "step.eliminate_add": {
        "zh": "R{a} ← R{a} + {factor}·R{b}",
        "en": "R{a} ← R{a} + {factor}·R{b}",
    },
    "step.eliminate_sub_one": {
        "zh": "R{a} ← R{a} − R{b}",
        "en": "R{a} ← R{a} − R{b}",
    },
    "step.eliminate_add_one": {
        "zh": "R{a} ← R{a} + R{b}",
        "en": "R{a} ← R{a} + R{b}",
    },
    "note.pinv.left": {
        "zh": "左满秩 → 伪逆 = 左逆 (AᵀA)⁻¹Aᵀ",
        "en": "Full column rank → pinv = left inverse (AᵀA)⁻¹Aᵀ",
    },
    "note.pinv.right": {
        "zh": "右满秩 → 伪逆 = 右逆 Aᵀ(AAᵀ)⁻¹",
        "en": "Full row rank → pinv = right inverse Aᵀ(AAᵀ)⁻¹",
    },
    "note.pinv.general": {
        "zh": "一般的 Moore-Penrose 伪逆（满秩时左/右逆都算不出来，只能走 SVD）",
        "en": "General Moore-Penrose pseudoinverse (via SVD)",
    },
    "note.left_inverse.plan": {
        "zh": "先算 AᵀA 并求逆，左逆 = (AᵀA)⁻¹Aᵀ",
        "en": "Compute AᵀA, invert it, then left-inverse = (AᵀA)⁻¹Aᵀ",
    },
    "note.right_inverse.plan": {
        "zh": "先算 AAᵀ 并求逆，右逆 = Aᵀ(AAᵀ)⁻¹",
        "en": "Compute AAᵀ, invert it, then right-inverse = Aᵀ(AAᵀ)⁻¹",
    },

    # --- examples.py: the study-note titles recommended under a result ------    # Also duplicated in web/examples.js and notes.js; tools/test_examples.py
    # asserts all three agree, in both languages, so they cannot drift.
    "note.matmul": {
        "zh": "矩阵乘法为什么这么怪",
        "en": "Why matrix multiplication looks so weird",
    },
    "note.transform": {
        "zh": "线性变换 T(x)：从函数到矩阵",
        "en": "Linear transformations T(x): from function to matrix",
    },
    "note.det_zero": {
        "zh": "det = 0 为什么就没有逆",
        "en": "Why det = 0 means there is no inverse",
    },
    "note.rank": {
        "zh": "秩到底在说什么",
        "en": "What rank is really saying",
    },
    "note.row_reduction": {
        "zh": "为什么行列式能用行变换来算",
        "en": "Why row operations can compute a determinant",
    },
    "note.adjugate": {
        "zh": "伴随矩阵与求逆公式",
        "en": "The adjugate and the inverse formula",
    },
    "note.eigen": {
        "zh": "特征值 / 特征向量的几何意义",
        "en": "The geometry of eigenvalues and eigenvectors",
    },
    "note.cofactor": {
        "zh": "代数余子式到底在干什么",
        "en": "What cofactors are actually doing",
    },
}


def tr(key, _lang=None, **kw):
    """Look up ``key`` and interpolate ``kw`` into it.

    ``_lang`` overrides the module language for this one call. It exists for the
    cross-language consistency checks (tools/test_examples.py needs both titles
    at once, without flipping global state); ordinary code should not pass it.
    """
    entry = MESSAGES.get(key)
    if entry is None:                      # a typo, not a translation gap
        return key
    lang = _lang if _lang in ("zh", "en") else _LANG
    text = entry.get(lang) or entry.get(FALLBACK_LANG) or key
    if not kw:
        return text
    try:
        return text.format(**kw)
    except (KeyError, IndexError):
        # A placeholder mismatch should not blank out a derivation; showing the
        # raw template is louder but still readable, and the guard test in
        # tools/test_core_i18n.py fails CI on a real mismatch.
        return text

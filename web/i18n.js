"use strict";
/* LA Helper 中英双语：字典 + 一键切换。
 *
 * 被 index.html 与 ai-help.html 共同加载，必须在 app.js / ai-help.js 之前。
 *
 * 用法：
 *   HTML:  data-i18n="key"                       -> 填 textContent
 *          data-i18n-html="key"                  -> 填 innerHTML（值里可带标签）
 *          data-i18n-attrs="title:k,placeholder:k" -> 填属性
 *   JS:    t("key")            /  t("key", {n: 3})   （{n} 会被替换）
 *
 * 约定：
 *   - 默认跟随浏览器语言；用户点过切换后以选择为准（localStorage["la-lang"]）。
 *   - 某个 key 在目标语言里缺失时回落到中文并 console.warn，绝不显示空白。
 */
window.LA_I18N = (function () {
  var STORE = "la-lang";
  var FALLBACK = "zh";

  var DICT = {
    zh: {
      // ---- 顶栏 ----
      "app.title": "LA Helper · 线性代数小算",
      "app.tagline": "本地运行 · 精确分数 · 可看计算步骤 · 学线代更顺手",
      "app.aiHelp": "AI Help",
      "app.aiHelpTip": "用 AI 解答线代问题（需自备 GLM 免费 Key）",
      "app.langTip": "切换中文 / English",
      "theme.toLight": "浅色",
      "theme.toDark": "深色",
      "theme.tip": "切换深色 / 浅色模式",

      // ---- 操作区 ----
      "op.label": "操作",
      "op.multiply": "矩阵乘法 A×B",
      "op.add": "加法 A+B",
      "op.sub": "减法 A−B",
      "op.transpose": "转置 Aᵀ",
      "op.scalar": "标量乘 k·A（k 填在 B 左上角）",
      "op.inverse": "方阵求逆 A⁻¹",
      "op.left_inverse": "左逆",
      "op.right_inverse": "右逆",
      "op.pseudo_inverse": "伪逆 A⁺",
      "op.lu": "LU 分解",
      "op.solve": "增广矩阵求解 Ax=b",
      "op.ref": "REF 行阶梯形",
      "op.det": "行列式 det(A)",
      "op.cofactor_matrix": "余子式矩阵 C &amp; 伴随矩阵 adj(A)",
      "op.rank": "秩 rank(A)",
      "op.eigen": "特征值 / 特征向量",
      "detMethod.label": "det 算法",
      "detMethod.row_reduction": "行变换法（推荐）",
      "detMethod.cofactor": "代数余子式展开",
      "operand.left": "左操作数",
      "operand.right": "右操作数",
      "opt.showSteps": "显示步骤",
      "opt.showDecimals": "小数显示",
      "btn.compute": "计算",

      // ---- 表达式 ----
      "expr.label": "表达式",
      "expr.placeholder": "inv(A) * B   或   det(A)   A^2   2*A - B",
      "btn.runExpr": "运行",
      "expr.available": "可用矩阵：{names}",

      // ---- 快捷键指南 ----
      "guide.summary": "快捷键指南（点开）",
      "guide.thSyntax": "写法",
      "guide.thMeaning": "含义",
      "guide.thOp": "下拉框里对应的操作",
      "guide.note": "可以连着写：<code>inv(A) * B - C</code>、<code>det(A * B)</code>、<code>3 * inv(A)</code>。<code>lu</code> / <code>solve</code> / <code>eigen</code> 的结果不止一项，只能单独使用。上面每一行都对应下拉框里的同一个操作，两条路算出来的结果完全一致。",
      "guide.rows": [
        ["A + B / A - B", "矩阵加减", "加法 / 减法"],
        ["A * B", "矩阵乘法", "矩阵乘法"],
        ["2 * A　A / 2", "标量乘 · 除以标量", "标量乘（k 写在式子里，不用填 B）"],
        ["inv(A)　A^-1", "方阵求逆", "方阵求逆"],
        ["A^2　A^0", "矩阵幂（A^0 为单位阵）", "—"],
        ["det(A)", "行列式（行变换法）", "行列式"],
        ["cofactor(A)", "行列式（代数余子式展开）", "行列式 + det 算法选「代数余子式展开」"],
        ["rank(A)", "秩", "秩"],
        ["ref(A)", "行阶梯形", "REF 行阶梯形"],
        ["T(A)　transpose(A)", "转置", "转置"],
        ["pinv(A)", "伪逆", "伪逆"],
        ["lu(A)", "LU 分解", "LU 分解"],
        ["solve(A, b)", "解 Ax = b", "增广矩阵求解"],
        ["eigen(A)", "特征值 / 特征向量", "特征值 / 特征向量"],
      ],

      // ---- 矩阵库 ----
      "lib.label": "矩阵库",
      "btn.settings": "设置",
      "btn.settingsTip": "设置 Gemini API Key",
      "btn.addMat": "＋ 新增",
      "settings.h3": "设置（Gemini API Key 仅存于本机浏览器）",
      "settings.apiKey": "API Key",
      "settings.apiKeyPh": "粘贴 aistudio.google.com 免费获取的 key",
      "settings.model": "模型",
      "btn.save": "保存",
      "settings.hint": "免费获取：https://aistudio.google.com → 左侧「Get API key」。密钥只存在你本地浏览器，不会上传到任何服务器（计算时仅直接发给 Google）。",

      // ---- 矩阵编辑面板 ----
      "mat.editing": "正在编辑",
      "btn.importImage": "从图片导入",
      "btn.rename": "改名",
      "btn.clear": "清空",
      "btn.delete": "删除",
      "dims.rows": "行",
      "dims.cols": "列",
      "dims.hint": "可从 Excel / 文本直接粘贴一整块数字",
      "preview.title": "预览",
      "preview.hint": "空格按 0 计算，灰字就是自动补的 0",

      // ---- 讲义 ----
      "notes.label": "线代难点小讲义",
      "notes.hint": "哪个概念卡住了就点一下 → 右侧显示讲解；点上面的「计算」即切回结果。",

      // ---- 结果区 ----
      "splitter.tip": "拖动调整左右两栏宽度",
      "empty.lead": "填好矩阵，写个算式，或从上面选操作",
      "empty.sub": "结果会在这里显示，勾选“显示步骤”可看详细推导",
      "result.title": "结果",
      "result.steps": "计算步骤",
      "result.lu": "LU 分解 &nbsp; P·A = L·U",
      "result.luP": "P（置换）",
      "result.luL": "L（单位下三角）",
      "result.luU": "U（上三角）",
      "result.solve": "求解结果：",
      "solve.unique": "唯一解",
      "solve.none": "无解",
      "solve.infinite": "无穷多解",
      "result.particular": "特解 x*",
      "result.nullBasis": "零空间基（自由变量：{vars}）",
      "result.computing": "计算中…",
      "result.noneOutput": "计算完成，无额外输出。",
      "result.timeout": "⚠️ 计算超时（>{sec}s），请减小矩阵规模或关闭「显示步骤」。",
      "result.failed": "⚠️ 请求失败：{err}",
      "inverse.none": "不存在：{note}",
      "cofactor.title": "余子式矩阵 C（C(i,j) = (−1)^(i+j)·M(i,j)）",
      "cofactor.adj": "伴随矩阵 adj(A) = Cᵀ",
      "cofactor.detHint": "det(A) = {det}；{tail}",
      "cofactor.invertible": "当 det(A) ≠ 0 时，A⁻¹ = adj(A) / det(A)。",
      "cofactor.singular": "（det = 0，矩阵不可逆，A⁻¹ 不存在）。",
      "eigen.title": "特征值 / 特征向量",
      "eigen.algebraic": "（代数重数 {n}",
      "eigen.geometric": "，几何重数 {n} → <span class=\"warn\">不可对角化</span>",
      "eigen.block": "特征值",
      "eigen.exact": "精确值",
      "eigen.exactForm": "精确形式：{v}",
      "eigen.notDiag": "（不可对角化）",

      // ---- 引擎状态（静态预览版） ----
      "engine.loading": "正在加载计算引擎（首次约需十几秒，之后秒回）…",
      "engine.busy": "计算引擎加载中，请稍候…",
      "engine.ready": "计算引擎已就绪 · 本地 Python/SymPy（WebAssembly）",
      "engine.fail": "引擎加载失败：",

      // ---- 编辑提示 / 报错 ----
      "msg.pasteShape": "已按粘贴内容识别为 {rows}×{cols}，共 {n} 个数",
      "msg.noNumbers": "剪贴板里没找到数字",
      "msg.pasteMismatch": "读到 {n} 个数：排不满当前的 {rows} 行，也不是方阵。请先在上面设置行列，或粘贴带换行的矩阵",
      "msg.pasteFilled": "已识别为 {rows}×{cols}，共 {n} 个数",
      "msg.noApiKey": "尚未配置 Gemini API Key，请点「设置」填入（免费，aistudio.google.com 获取）。",
      "msg.readFail": "读取失败",
      "msg.badModel": "模型名不合法：{model}（只允许字母、数字、. _ -）",
      "msg.network": "网络 / CORS 错误（{err}）。若浏览器拦截跨域请求，请改用桌面版。",
      "msg.http": "HTTP {status}：{detail}",
      "msg.geminiFormat": "Gemini 返回格式异常：{data}",
      "msg.badImageFmt": "不支持的图片格式：{ext}",
      "msg.engineNotReady": "计算引擎尚未就绪，请稍候再试（图片识别需在 Pyodide 静态版中使用）。",
      "msg.recognizing": "正在识别图片…",
      "msg.readImageFail": "读取图片失败：{err}",
      "msg.geminiFail": "调用 Gemini 失败：{err}",
      "photo.parseFail": "识别失败：解析异常",
      "photo.rawHint": "模型返回的原始文本（可据此手动填入）：",
      "photo.cannotParse": "无法解析出矩阵（请手动核对原始返回）",
      "msg.imported": "已从图片导入 {rows}×{cols} 矩阵，请核对后计算",
      "msg.added": "已新增 {name}",
      "msg.keepOne": "至少要保留一个矩阵",
      "msg.deleted": "已删除 {name}",
      "msg.cleared": "已清空 {name}",
      "msg.badName": "名称要以字母开头，最多 8 位字母或数字",
      "msg.dupName": "已经有一个叫 {name} 的矩阵了",
      "msg.renamed": "已改名为 {name}",
      "msg.settingsSaved": "设置已保存",
      "msg.resizedKeep": "已改为 {rows}×{cols}，原有数据保留",
      "msg.resized": "已改为 {rows}×{cols}",

      // ---- AI Help 页 ----
      "ai.title": "AI Help · 线代小助手",
      "ai.tagline": "用 GLM-4-Flash（免费）直连解答线代问题 · Key 只存本机",
      "ai.back": "← 返回",
      "ai.keyTitle": "先填 GLM API Key",
      "ai.keyIntro": "首次使用请填入你的 <b>GLM API Key</b>（免费，在 <a href=\"https://open.bigmodel.cn\" target=\"_blank\" rel=\"noopener\">open.bigmodel.cn</a> 申请，选 <b>GLM-4-Flash</b> 即可无限免费用）。Key 只存在你本机浏览器，不上传任何服务器。",
      "ai.keyPh": "粘贴 GLM API Key（sk-...）",
      "ai.saveKey": "保存",
      "ai.noKey": "请先粘贴 Key。",
      "ai.askPh": "用中文问一个线代问题，例如：为什么 det(AB)=det(A)det(B)？",
      "ai.changeKey": "更换 Key",
      "ai.send": "提问",
      "ai.thinking": "AI 正在思考…",
      "ai.badKey": "Key 无效或已过期（{msg}），请重新填入。",
      "ai.rateLimited": "免费额度被限流了（429），稍等几秒再试一次。",
      "ai.error": "出错了：{msg}",
      "ai.empty": "（模型没有返回内容）",
      "ai.netError": "网络错误：{msg}（需能访问 open.bigmodel.cn）",
      "ai.storageWarn": "注意：当前浏览器无法长期保存 Key（可能是隐私模式或用 file:// 打开）。本次会话内可正常使用，刷新页面后需重新填写。",
      "ai.keyCleared": "已清除本机 Key，请重新填入。",
      "ai.count": "{n} / 300",
      "ai.systemPrompt": "你是 LA Helper 的线代学习小助手，面向高中生和大学生。用简洁、准确、循序渐进的中文回答线代问题，尽量给出关键步骤与直觉，必要时用 LaTeX 风格公式（行内 $...$，独立公式 $$...$$）。除非用户要求更详细，否则回答控制在 300 字以内。",
    },

    en: {
      // ---- header ----
      "app.title": "LA Helper · Linear Algebra Calculator",
      "app.tagline": "Runs locally · Exact fractions · Step-by-step · Made for learning",
      "app.aiHelp": "AI Help",
      "app.aiHelpTip": "Ask an AI about linear algebra (needs your own free GLM key)",
      "app.langTip": "Switch 中文 / English",
      "theme.toLight": "Light",
      "theme.toDark": "Dark",
      "theme.tip": "Switch dark / light mode",

      // ---- operations ----
      "op.label": "Operation",
      "op.multiply": "Matrix product A×B",
      "op.add": "Addition A+B",
      "op.sub": "Subtraction A−B",
      "op.transpose": "Transpose Aᵀ",
      "op.scalar": "Scalar multiply k·A (k in B's top-left)",
      "op.inverse": "Inverse A⁻¹",
      "op.left_inverse": "Left inverse",
      "op.right_inverse": "Right inverse",
      "op.pseudo_inverse": "Pseudo-inverse A⁺",
      "op.lu": "LU decomposition",
      "op.solve": "Solve Ax=b (augmented)",
      "op.ref": "REF (row echelon form)",
      "op.det": "Determinant det(A)",
      "op.cofactor_matrix": "Cofactor matrix C &amp; adjugate adj(A)",
      "op.rank": "Rank rank(A)",
      "op.eigen": "Eigenvalues / eigenvectors",
      "detMethod.label": "det method",
      "detMethod.row_reduction": "Row reduction (recommended)",
      "detMethod.cofactor": "Cofactor expansion",
      "operand.left": "Left operand",
      "operand.right": "Right operand",
      "opt.showSteps": "Show steps",
      "opt.showDecimals": "Show decimals",
      "btn.compute": "Compute",

      // ---- expression ----
      "expr.label": "Expression",
      "expr.placeholder": "inv(A) * B   or   det(A)   A^2   2*A - B",
      "btn.runExpr": "Run",
      "expr.available": "Matrices available: {names}",

      // ---- shortcut guide ----
      "guide.summary": "Shortcut guide (click to expand)",
      "guide.thSyntax": "Syntax",
      "guide.thMeaning": "Meaning",
      "guide.thOp": "Matching dropdown operation",
      "guide.note": "You can chain them: <code>inv(A) * B - C</code>, <code>det(A * B)</code>, <code>3 * inv(A)</code>. <code>lu</code> / <code>solve</code> / <code>eigen</code> return more than one thing, so use them on their own. Every row above maps to the same dropdown operation — both paths give identical results.",
      "guide.rows": [
        ["A + B / A - B", "Matrix add / subtract", "Addition / Subtraction"],
        ["A * B", "Matrix product", "Matrix product"],
        ["2 * A　A / 2", "Scalar multiply · divide by scalar", "Scalar multiply (k goes in the expression, no need to fill B)"],
        ["inv(A)　A^-1", "Inverse of a square matrix", "Inverse"],
        ["A^2　A^0", "Matrix power (A^0 is the identity)", "—"],
        ["det(A)", "Determinant (row reduction)", "Determinant"],
        ["cofactor(A)", "Determinant (cofactor expansion)", "Determinant + det method \"Cofactor expansion\""],
        ["rank(A)", "Rank", "Rank"],
        ["ref(A)", "Row echelon form", "REF (row echelon form)"],
        ["T(A)　transpose(A)", "Transpose", "Transpose"],
        ["pinv(A)", "Pseudo-inverse", "Pseudo-inverse"],
        ["lu(A)", "LU decomposition", "LU decomposition"],
        ["solve(A, b)", "Solve Ax = b", "Solve Ax=b (augmented)"],
        ["eigen(A)", "Eigenvalues / eigenvectors", "Eigenvalues / eigenvectors"],
      ],

      // ---- matrix library ----
      "lib.label": "Matrix library",
      "btn.settings": "Settings",
      "btn.settingsTip": "Set the Gemini API key",
      "btn.addMat": "＋ New",
      "settings.h3": "Settings (the Gemini API key stays in this browser only)",
      "settings.apiKey": "API key",
      "settings.apiKeyPh": "Paste the free key from aistudio.google.com",
      "settings.model": "Model",
      "btn.save": "Save",
      "settings.hint": "Get one free: https://aistudio.google.com → \"Get API key\" in the left sidebar. The key lives only in your browser and is never uploaded anywhere (it is sent straight to Google when computing).",

      // ---- matrix editor ----
      "mat.editing": "Editing",
      "btn.importImage": "Import from image",
      "btn.rename": "Rename",
      "btn.clear": "Clear",
      "btn.delete": "Delete",
      "dims.rows": "Rows",
      "dims.cols": "Cols",
      "dims.hint": "You can paste a whole block of numbers straight from Excel / text",
      "preview.title": "Preview",
      "preview.hint": "Blanks count as 0 — the grey digits are the auto-filled zeros",

      // ---- study notes ----
      "notes.label": "Linear algebra study notes",
      "notes.hint": "Stuck on a concept? Click one → it shows on the right; click \"Compute\" above to go back to results.",

      // ---- results ----
      "splitter.tip": "Drag to resize the two columns",
      "empty.lead": "Fill in a matrix, type an expression, or pick an operation above",
      "empty.sub": "Results appear here — tick \"Show steps\" to see the full derivation",
      "result.title": "Result",
      "result.steps": "Steps",
      "result.lu": "LU decomposition &nbsp; P·A = L·U",
      "result.luP": "P (permutation)",
      "result.luL": "L (unit lower triangular)",
      "result.luU": "U (upper triangular)",
      "result.solve": "Solution: ",
      "solve.unique": "unique solution",
      "solve.none": "no solution",
      "solve.infinite": "infinitely many solutions",
      "result.particular": "Particular solution x*",
      "result.nullBasis": "Null-space basis (free variables: {vars})",
      "result.computing": "Computing…",
      "result.noneOutput": "Done — nothing extra to display.",
      "result.timeout": "⚠️ Timed out (>{sec}s). Try a smaller matrix or turn off \"Show steps\".",
      "result.failed": "⚠️ Request failed: {err}",
      "inverse.none": "Does not exist: {note}",
      "cofactor.title": "Cofactor matrix C (C(i,j) = (−1)^(i+j)·M(i,j))",
      "cofactor.adj": "Adjugate adj(A) = Cᵀ",
      "cofactor.detHint": "det(A) = {det}; {tail}",
      "cofactor.invertible": "when det(A) ≠ 0, A⁻¹ = adj(A) / det(A).",
      "cofactor.singular": "(det = 0 — the matrix is singular, so A⁻¹ does not exist).",
      "eigen.title": "Eigenvalues / eigenvectors",
      "eigen.algebraic": "(algebraic multiplicity {n}",
      "eigen.geometric": ", geometric multiplicity {n} → <span class=\"warn\">not diagonalisable</span>",
      "eigen.block": "Eigenvalues",
      "eigen.exact": "Exact value",
      "eigen.exactForm": "Exact form: {v}",
      "eigen.notDiag": "(not diagonalisable)",

      // ---- engine status (static preview) ----
      "engine.loading": "Loading the compute engine (first time takes ~10s, then it is instant)…",
      "engine.busy": "Compute engine is still loading, please wait…",
      "engine.ready": "Engine ready · local Python/SymPy (WebAssembly)",
      "engine.fail": "Engine failed to load: ",

      // ---- editor messages / errors ----
      "msg.pasteShape": "Recognised {rows}×{cols} from the pasted block — {n} numbers",
      "msg.noNumbers": "No numbers found in the clipboard",
      "msg.pasteMismatch": "Read {n} numbers: they don't fill the current {rows} rows, and it isn't a square either. Set the rows/cols above first, or paste a matrix with line breaks.",
      "msg.pasteFilled": "Recognised {rows}×{cols} — {n} numbers",
      "msg.noApiKey": "No Gemini API key yet — click \"Settings\" and paste one (free from aistudio.google.com).",
      "msg.readFail": "Read failed",
      "msg.badModel": "Invalid model name: {model} (only letters, digits, . _ - allowed)",
      "msg.network": "Network / CORS error ({err}). If the browser blocks the cross-origin call, use the desktop edition instead.",
      "msg.http": "HTTP {status}: {detail}",
      "msg.geminiFormat": "Unexpected Gemini response: {data}",
      "msg.badImageFmt": "Unsupported image format: {ext}",
      "msg.engineNotReady": "The compute engine isn't ready yet — try again in a moment (image import needs the Pyodide static build).",
      "msg.recognizing": "Reading the image…",
      "msg.readImageFail": "Could not read the image: {err}",
      "msg.geminiFail": "Gemini call failed: {err}",
      "photo.parseFail": "Recognition failed: parsing error",
      "photo.rawHint": "Raw text returned by the model (fill it in by hand from this):",
      "photo.cannotParse": "No matrix could be parsed (check the raw response manually)",
      "msg.imported": "Imported a {rows}×{cols} matrix from the image — please check it before computing",
      "msg.added": "Added {name}",
      "msg.keepOne": "You need to keep at least one matrix",
      "msg.deleted": "Deleted {name}",
      "msg.cleared": "Cleared {name}",
      "msg.badName": "Names must start with a letter — up to 8 letters or digits",
      "msg.dupName": "There is already a matrix called {name}",
      "msg.renamed": "Renamed to {name}",
      "msg.settingsSaved": "Settings saved",
      "msg.resizedKeep": "Resized to {rows}×{cols} — existing values kept",
      "msg.resized": "Resized to {rows}×{cols}",

      // ---- AI Help page ----
      "ai.title": "AI Help · Linear algebra tutor",
      "ai.tagline": "Answer powered by GLM-4-Flash (free tier) · your key stays on this device",
      "ai.back": "← Back",
      "ai.keyTitle": "Enter your GLM API key first",
      "ai.keyIntro": "First time here? Paste your <b>GLM API key</b> (free — get it at <a href=\"https://open.bigmodel.cn\" target=\"_blank\" rel=\"noopener\">open.bigmodel.cn</a> and pick <b>GLM-4-Flash</b> for unlimited free use). The key is stored only in this browser and is never uploaded anywhere.",
      "ai.keyPh": "Paste your GLM API key (sk-...)",
      "ai.saveKey": "Save",
      "ai.noKey": "Please paste a key first.",
      "ai.askPh": "Ask a linear algebra question, e.g. why is det(AB) = det(A)det(B)?",
      "ai.changeKey": "Change key",
      "ai.send": "Ask",
      "ai.thinking": "Thinking…",
      "ai.badKey": "Key is invalid or expired ({msg}) — please enter it again.",
      "ai.rateLimited": "Free-tier rate limit hit (429) — try again in a few seconds.",
      "ai.error": "Something went wrong: {msg}",
      "ai.empty": "(the model returned nothing)",
      "ai.netError": "Network error: {msg} (needs access to open.bigmodel.cn)",
      "ai.storageWarn": "Note: this browser can't save the key permanently (private mode, or opened via file://). It works for this session, but you'll need to paste it again after a reload.",
      "ai.keyCleared": "Saved key cleared — please paste it again.",
      "ai.count": "{n} / 300",
      "ai.systemPrompt": "You are LA Helper's linear algebra tutor for high-school and university students. Answer in English, concisely and accurately, building up step by step. Give the key steps and the intuition, and use LaTeX-style formulas when they help (inline $...$, display $$...$). Unless asked for more detail, keep answers under 300 words.",
    },
  };

  function norm(l) { return l === "en" ? "en" : "zh"; }

  function stored() {
    try { return localStorage.getItem(STORE); } catch (_) { return null; }
  }

  /** 没手动选过时才跟随浏览器语言。 */
  function detect() {
    try {
      var nav = (navigator.languages && navigator.languages[0]) ||
                navigator.language || "";
      return /^zh/i.test(nav) ? "zh" : "en";
    } catch (_) { return FALLBACK; }
  }

  function get() {
    var s = stored();
    return (s === "zh" || s === "en") ? s : detect();
  }

  function set(l) {
    l = norm(l);
    try { localStorage.setItem(STORE, l); } catch (_) { /* 存不了就只本次生效 */ }
    return l;
  }

  function t(key, vars) {
    var lang = get();
    var s = DICT[lang] ? DICT[lang][key] : undefined;
    if (s == null) {
      s = DICT[FALLBACK][key];
      if (s != null && window.console) {
        console.warn("[i18n] missing '" + lang + "' translation for: " + key);
      }
    }
    if (s == null) { return key; }
    if (vars) {
      for (var k in vars) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return s;
  }

  function apply(root) {
    root = root || document;
    var lang = get();
    document.documentElement.setAttribute("lang", lang === "zh" ? "zh-CN" : "en");
    document.documentElement.setAttribute("data-lang", lang);

    var nodes = root.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute("data-i18n"));
    }
    var htmlNodes = root.querySelectorAll("[data-i18n-html]");
    for (var j = 0; j < htmlNodes.length; j++) {
      htmlNodes[j].innerHTML = t(htmlNodes[j].getAttribute("data-i18n-html"));
    }
    var attrNodes = root.querySelectorAll("[data-i18n-attrs]");
    for (var k = 0; k < attrNodes.length; k++) {
      var spec = attrNodes[k].getAttribute("data-i18n-attrs") || "";
      var pairs = spec.split(",");
      for (var p = 0; p < pairs.length; p++) {
        var bits = pairs[p].split(":").map(function (x) { return x.trim(); });
        if (bits[0] && bits[1]) attrNodes[k].setAttribute(bits[0], t(bits[1]));
      }
    }
  }

  // 语言切换后需要重画动态内容（讲义 chips、结果区等）的回调。
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }

  function switchTo(l) {
    l = set(l);
    apply(document);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](l); } catch (e) { if (window.console) console.error(e); }
    }
    return l;
  }

  function toggle() { return switchTo(get() === "zh" ? "en" : "zh"); }

  /** 切换按钮上显示的是「点了会变成的那一种」。 */
  function toggleLabel() { return get() === "zh" ? "EN" : "中文"; }

  return {
    dict: DICT,
    get: get,
    set: set,
    t: t,
    apply: apply,
    onChange: onChange,
    switchTo: switchTo,
    toggle: toggle,
    toggleLabel: toggleLabel,
  };
})();

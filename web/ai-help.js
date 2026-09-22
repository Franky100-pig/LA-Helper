"use strict";
const el = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 主题：与主页同一套（默认跟随系统，手动选择存 localStorage["la-theme"]）
// ---------------------------------------------------------------------------
(function initTheme() {
  const KEY = "la-theme";
  const btn = el("themeToggle");
  const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (_) { return null; }
  }
  function current() {
    return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  }
  function apply(t) {
    document.documentElement.setAttribute("data-theme", t);
    if (btn) btn.textContent = t === "dark" ? "浅色" : "深色";
  }
  function toggle() {
    const next = current() === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (_) { /* 存不了就只本次生效 */ }
  }

  apply(current());
  if (btn) btn.addEventListener("click", toggle);
  if (mq) {
    const onChange = (e) => {
      const s = stored();
      if (s !== "light" && s !== "dark") apply(e.matches ? "light" : "dark");
    };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  }
})();

// ---------------------------------------------------------------------------
// AI Help：用 GLM-4-Flash（免费）直连解答线代问题。
// 纯静态页无后端：浏览器直接 fetch open.bigmodel.cn（已验证 CORS 允许任意来源），
// Key 只存本机 localStorage，不经过任何中转。问题限制 ≤300 字。
// ---------------------------------------------------------------------------
(function initAiHelp() {
  const KEY_STORE = "la-glm-key";
  const ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
  const MODEL = "glm-4-flash";
  const MAX = 300;

  const keyBox = el("aiHelpKeyBox");
  const askBox = el("aiHelpAskBox");
  const keyIn = el("aiHelpKeyIn");
  const saveKeyBtn = el("aiHelpSaveKey");
  const keyMsg = el("aiHelpKeyMsg");
  const qEl = el("aiHelpQ");
  const countEl = el("aiHelpCount");
  const sendBtn = el("aiHelpSend");
  const changeKeyBtn = el("aiHelpChangeKey");
  const answerEl = el("aiHelpAnswer");
  const statusEl = el("aiHelpStatus");

  // Key 存储：优先 localStorage；被浏览器禁用时回落到 sessionStorage；
  // 再不行就用内存变量兜底，保证本次会话「提问」按钮不会因存不住 Key 而失活。
  // （file:// 在 Safari、以及部分沙箱预览里会禁用 localStorage，旧逻辑会因此把
  //  提问按钮永久置灰，现象就是「粘贴了 Key 还是不行」。）
  let memKey = null;
  function readStore() {
    try { return localStorage.getItem(KEY_STORE) || ""; } catch (_) { return ""; }
  }
  function writeStore(k) {
    try { localStorage.setItem(KEY_STORE, k || ""); return "local"; }
    catch (_) {
      try { sessionStorage.setItem(KEY_STORE, k || ""); return "session"; }
      catch (__){ return null; }
    }
  }
  function getKey() { return memKey || readStore(); }
  function setKey(k) {
    memKey = k || "";
    return writeStore(k);
  }

  function showKeyView(msg) {
    keyBox.hidden = false;
    askBox.hidden = true;
    if (msg) keyMsg.textContent = msg;
    keyIn.value = "";
    setTimeout(() => keyIn.focus(), 30);
  }
  function showAskView() {
    keyBox.hidden = true;
    askBox.hidden = false;
    answerEl.textContent = "";
    statusEl.textContent = "";
    updateCount();
    setTimeout(() => qEl.focus(), 30);
  }

  // 把模型返回的文本渲染成可读公式。模型被要求用 $...$（行内）/ $$...$$（独立）
  // 写 LaTeX，也兼容 \(...\) / \[...\]。KaTeX 没加载到时（两个 CDN 都挂了）
  // 直接回退为纯文本，不会白屏。
  const MATH_RE = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?!\$)([^$\n]+?)\$/g;
  function renderAnswer(text) {
    answerEl.textContent = "";
    if (!text) return;
    if (!window.katex) { answerEl.textContent = text; return; }
    let last = 0, m;
    MATH_RE.lastIndex = 0;
    while ((m = MATH_RE.exec(text))) {
      if (m.index > last) {
        answerEl.appendChild(document.createTextNode(text.slice(last, m.index)));
      }
      const tex = (m[1] ?? m[2] ?? m[3] ?? m[4]).trim();
      const display = m[1] !== undefined || m[2] !== undefined;
      const node = document.createElement(display ? "div" : "span");
      node.className = display ? "ai-math-block" : "ai-math";
      try {
        window.katex.render(tex, node, { throwOnError: false, displayMode: display });
      } catch (_) {
        node.textContent = m[0]; // 渲染失败就原样显示该段
      }
      answerEl.appendChild(node);
      last = MATH_RE.lastIndex;
    }
    if (last < text.length) answerEl.appendChild(document.createTextNode(text.slice(last)));
  }

  function updateCount() {
    const n = qEl.value.length;
    countEl.textContent = n + " / " + MAX;
    sendBtn.disabled = !getKey() || n === 0 || n > MAX;
  }

  changeKeyBtn.addEventListener("click", () => {
    setKey("");
    showKeyView("已清除本机 Key，请重新填入。");
  });

  saveKeyBtn.addEventListener("click", () => {
    const k = keyIn.value.trim();
    if (!k) { keyMsg.textContent = "请先粘贴 Key。"; return; }
    const where = setKey(k);
    showAskView();
    if (!where) {
      statusEl.textContent = "注意：当前浏览器无法长期保存 Key（可能是隐私模式或用 file:// 打开）。本次会话内可正常使用，刷新页面后需重新填写。";
    }
  });

  qEl.addEventListener("input", updateCount);

  sendBtn.addEventListener("click", async () => {
    const q = qEl.value.trim();
    const key = getKey();
    if (!q || !key) return;
    sendBtn.disabled = true;
    answerEl.textContent = "";
    statusEl.textContent = "AI 正在思考…";
    try {
      const resp = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + key,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: [
            { role: "system", content:
              "你是 LA Helper 的线代学习小助手，面向高中生和大学生。用简洁、准确、循序渐进的中文回答线代问题，" +
              "尽量给出关键步骤与直觉，必要时用 LaTeX 风格公式（行内 $...$，独立公式 $$...$$）。" +
              "除非用户要求更详细，否则回答控制在 300 字以内。" },
            { role: "user", content: q },
          ],
          temperature: 0.3,
          max_tokens: 600,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const msg = data && data.error && data.error.message;
        if (resp.status === 401) {
          setKey("");
          showKeyView("Key 无效或已过期（" + (msg || "401") + "），请重新填入。");
          return;
        }
        if (resp.status === 429) {
          statusEl.textContent = "免费额度被限流了（429），稍等几秒再试一次。";
          return;
        }
        statusEl.textContent = "出错了：" + (msg || ("HTTP " + resp.status));
        return;
      }
      const ans = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      statusEl.textContent = "";
      renderAnswer(ans || "（模型没有返回内容）");
    } catch (err) {
      statusEl.textContent = "网络错误：" + err.message + "（需能访问 open.bigmodel.cn）";
    } finally {
      sendBtn.disabled = false;
      updateCount();
    }
  });

  // 启动：已存 Key 就直接进提问页，否则显示填 Key
  if (getKey()) showAskView(); else showKeyView("");
  updateCount();
})();

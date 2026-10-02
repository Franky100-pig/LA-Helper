"use strict";
const el = (id) => document.getElementById(id);
// 复用主页那套双语字典（i18n.js 已在 <head> 先加载）
const I18N = window.LA_I18N;
const tr = I18N.t;

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
    if (btn) btn.textContent = t === "dark" ? tr("theme.toLight") : tr("theme.toDark");
  }
  function toggle() {
    const next = current() === "dark" ? "light" : "dark";
    apply(next);
    try { localStorage.setItem(KEY, next); } catch (_) { /* 存不了就只本次生效 */ }
  }

  apply(current());
  I18N.onChange(() => apply(current()));   // 切语言时按钮文案跟着变
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

  // 公共共享 Key（GLM-4-Flash 免费额度）。
  //
  // 为什么敢公开：这是纯静态页，浏览器直连 open.bigmodel.cn，Key 必然要出现在
  // 前端代码里 —— 区别只在于「官方发一个」还是「每个人自己去注册一个」。
  // 之前要求用户先注册、拿 Key、再粘贴，转化率几乎为零。
  //
  // 代价（知情选择，不是疏忽）：
  // · 共享额度 → 有人滥用会触发 429，所有人一起变慢；
  // · 这个 Key 随时可能失效或被回收；
  // · 介意的话在「更换 Key」里填自己的，自己的会存在本机并优先生效。
  //
  // 换成空字符串即可一键停用，用户会回到「必须自己填 Key」的状态。
  // 停用/启用都不需要改其他地方：所有相关分支都测过两种模式。
  const SHARED_KEY = "ad05fe8940a849849b24a01e70b031bc.D0WSOEaNzjKc6phP";

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
  const sharedNote = el("aiHelpSharedNote");

  // 有公共 Key 时提示一下「你可以直接用，也可以换成自己的」
  if (sharedNote) {
    sharedNote.hidden = !SHARED_KEY;
    if (SHARED_KEY) sharedNote.textContent = tr("ai.sharedNote");
  }

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
  function getKey() { return memKey || readStore() || SHARED_KEY; }
  function setKey(k) {
    memKey = k || "";
    return writeStore(k);
  }
  /** 用户是否填了自己的 Key（决定保存/更换按钮的语义）。 */
  function hasOwnKey() { return !!(memKey || readStore()); }

  function showKeyView(msg) {
    keyBox.hidden = false;
    askBox.hidden = true;
    if (msg) keyMsg.textContent = msg;
    // 有公共 Key 就预填，用户可以直接点「保存」；没有才留空让他粘贴
    keyIn.value = hasOwnKey() ? getKey() : "";
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
    countEl.textContent = tr("ai.count", { n: n });
    sendBtn.disabled = !getKey() || n === 0 || n > MAX;
  }

  changeKeyBtn.addEventListener("click", () => {
    setKey("");
    // 注意：清掉的只是「我自己存的 Key」。公共 Key 是代码里的常量，
    // 所以点了「更换 Key」之后依然能用公共 Key —— 这正是「更换」该有的行为，
    // 不是把用户彻底挡在门外。
    showKeyView(tr("ai.keyCleared"));
  });

  saveKeyBtn.addEventListener("click", () => {
    const k = keyIn.value.trim();
    // 留空表示「用公共 Key」：不是错误，别把人拦在这一步
    if (!k) {
      if (SHARED_KEY) { setKey(""); showAskView(); }
      else { keyMsg.textContent = tr("ai.noKey"); }
      return;
    }
    const where = setKey(k);
    showAskView();
    if (!where) {
      statusEl.textContent = tr("ai.storageWarn");
    }
  });

  qEl.addEventListener("input", updateCount);

  sendBtn.addEventListener("click", async () => {
    const q = qEl.value.trim();
    const key = getKey();
    if (!q || !key) return;
    // 先记下用的是「自己的 Key」还是「公共 Key」：下面的错误处理要靠它
    // 决定是提示 Key 无效，还是提示共享 Key 挂了。
    const hasOwnKeyBefore = hasOwnKey();
    sendBtn.disabled = true;
    answerEl.textContent = "";
    statusEl.textContent = tr("ai.thinking");
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
            { role: "system", content: tr("ai.systemPrompt") },
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
          // 用的是公共 Key 却 401 → 多半是共享 Key 失效/被回收了。
          // 直接把人推回「填自己的 Key」，别让一个死掉的共享 Key
          // 变成整页功能不可用。
          showKeyView(tr(hasOwnKeyBefore ? "ai.badKey" : "ai.sharedKeyDead",
                         { msg: msg || "401" }));
          return;
        }
        if (resp.status === 429) {
          // 共享额度被打满时，自己的 Key 往往是好的 —— 直接提示换 Key 试试
          statusEl.textContent = tr(hasOwnKeyBefore ? "ai.rateLimited" : "ai.sharedRateLimited");
          return;
        }
        statusEl.textContent = tr("ai.error", { msg: msg || ("HTTP " + resp.status) });
        return;
      }
      const ans = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      statusEl.textContent = "";
      renderAnswer(ans || tr("ai.empty"));
    } catch (err) {
      statusEl.textContent = tr("ai.netError", { msg: err.message });
    } finally {
      sendBtn.disabled = false;
      updateCount();
    }
  });

  // 启动：已存 Key 就直接进提问页，否则显示填 Key
  if (getKey()) showAskView(); else showKeyView("");
  updateCount();
})();

// ---------------------------------------------------------------------------
// 中文 / English 一键切换：与主页共用 localStorage["la-lang"]，切完立即重画。
// ---------------------------------------------------------------------------
(function initLang() {
  const btn = document.getElementById("langToggle");
  function syncButton() { if (btn) btn.textContent = I18N.toggleLabel(); }

  I18N.apply(document);
  syncButton();

  if (btn) btn.addEventListener("click", () => { I18N.toggle(); });

  // apply() 会把 #aiHelpCount 重填成 "0 / 300"，这里按当前输入长度再刷一次
  I18N.onChange(() => {
    syncButton();
    updateCount();
  });
})();

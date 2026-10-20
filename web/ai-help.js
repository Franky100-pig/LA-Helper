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
// AI Help：免费模型直连解答线代问题。
// 纯静态页无后端：浏览器直接 fetch 模型 API，Key 只存本机 localStorage，
// 不经过任何中转。问题限制 ≤500 字。
//
// 为什么有两个 Provider：2026-10 起 open.bigmodel.cn 的 CORS 预检（OPTIONS）
// 不再返回 Access-Control-* 头（网关/WAF 行为变更，POST 与 Key 都正常），
// 浏览器直连全部死在预检上 → 报 TypeError: Failed to fetch。所以默认走
// SiliconFlow（预检实测正常、有免费模型），GLM 留作自动回退：智谱修好后
// 无需再改代码。
// ---------------------------------------------------------------------------
(function initAiHelp() {
  const KEY_STORE = "la-glm-key";   // 沿用旧名：老用户已存的 GLM Key 不作废
  const MAX = 500;

  // 公共共享 Key（免费模型额度）。
  //
  // 为什么敢公开：这是纯静态页，浏览器直连模型 API，Key 必然要出现在
  // 前端代码里 —— 区别只在于「官方发一个」还是「每个人自己去注册一个」。
  // 之前要求用户先注册、拿 Key、再粘贴，转化率几乎为零。
  //
  // 代价（知情选择，不是疏忽）：
  // · 共享额度 → 有人滥用会触发 429，所有人一起变慢；
  // · 这个 Key 随时可能失效或被回收；
  // · 介意的话在「更换 Key」里填自己的，自己的会存在本机并优先生效。
  //
  // 换成空字符串即可一键停用，用户会回到「必须自己填 Key」的状态。
  // 停用/启用都不需要改其他地方：所有相关分支都有测试钉死。
  // 主力：SiliconFlow（sk- 开头，免费档模型 Qwen3-8B）
  const SHARED_KEY = "sk-amjggipbckwxkjxumhrfsulwefoecamwzsanxlkkmswsqesx";
  // 回退：智谱 open.bigmodel.cn（GLM-4-Flash；2026-10 预检被平台改坏，
  // 修好前只对「自己填了 GLM Key」的用户真正可用）
  const SHARED_KEY_GLM = "ad05fe8940a849849b24a01e70b031bc.D0WSOEaNzjKc6phP";

  const PROVIDERS = [
    {
      id: "siliconflow",
      endpoint: "https://api.siliconflow.cn/v1/chat/completions",
      model: "Qwen/Qwen3-8B",
      sharedKey: SHARED_KEY,
      // Qwen3 系是混合推理模型：显式关掉思考模式，否则非流式请求可能把
      // 回答写进 reasoning_content、content 反而为空
      extra: { enable_thinking: false },
    },
    {
      id: "bigmodel",
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4-flash",
      sharedKey: SHARED_KEY_GLM,
      extra: null,
    },
  ];

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

  // 任一平台还挂着公共 Key，就提示「你可以直接用，也可以换成自己的」
  const anyShared = !!(SHARED_KEY || SHARED_KEY_GLM);
  if (sharedNote) {
    sharedNote.hidden = !anyShared;
    if (anyShared) sharedNote.textContent = tr("ai.sharedNote");
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
  function setKey(k) {
    memKey = k || "";
    return writeStore(k);
  }
  /** 用户是否填了自己的 Key（决定保存/更换按钮的语义）。 */
  function hasOwnKey() { return !!(memKey || readStore()); }

  // 自有 Key 按前缀路由：SiliconFlow 是 sk-…，GLM 是 id.secret 形态
  function pickProvider(key) {
    return key.startsWith("sk-") ? PROVIDERS[0] : PROVIDERS[1];
  }
  // 本次「提问」要依次尝试的 (provider, key) 列表：
  // 有自己的 Key → 只用自己那份（Key 与平台绑定，不跨平台瞎试）；
  // 没有则按顺序试每个还有公共 Key 的平台，一个挂了自动换下一个。
  function attempts() {
    const own = memKey || readStore();
    if (own) return [{ provider: pickProvider(own), key: own, own: true }];
    return PROVIDERS.filter((p) => p.sharedKey)
                    .map((p) => ({ provider: p, key: p.sharedKey, own: false }));
  }
  // 「现在有没有可用的 Key」——取第一条尝试的 Key；决定发送按钮是否可点
  function getKey() {
    const list = attempts();
    return list.length ? list[0].key : "";
  }

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
      if (anyShared) { setKey(""); showAskView(); }
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

  // 对单个 (provider, key) 发起一次问答。
  // 返回值约定：
  //   { kind: "answer", text }                        成功
  //   { kind: "status", key, msg }                    直接展示状态文案，停止
  //   { kind: "keyview", key, msg }                   推回填 Key 页，停止
  //   { kind: "next", fatal, msg, err }               本平台不行，换下一个
  //     fatal: "401" | "429" | "net" —— 全部尝试失败时决定收尾文案
  async function askOne(attempt, q) {
    const p = attempt.provider;
    let resp;
    try {
      resp = await fetch(p.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + attempt.key,
        },
        body: JSON.stringify(Object.assign({
          model: p.model,
          messages: [
            { role: "system", content: tr("ai.systemPrompt") },
            { role: "user", content: q },
          ],
          temperature: 0.3,
          // 上限要留得比「回答长度」宽松：systemPrompt 允许写到几百字，
          // 而带 LaTeX 公式的答案 token 数远超字数（中英都不止），
          // 卡太紧会让回答在半句话处被截断。
          max_tokens: 2000,
        }, p.extra || {})),
      });
    } catch (err) {
      // fetch 抛 TypeError 通常是「预检失败 / 网络不通」，不是 Key 的问题
      return { kind: "next", fatal: "net", msg: err.message, err };
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = data && data.error && data.error.message;
      if (resp.status === 401) {
        // 自己的 Key 401 → 多半填错了，推回填 Key 页；
        // 公共 Key 401 → 换下一个平台的公共 Key 试试
        return attempt.own
          ? { kind: "keyview", key: "ai.badKey", msg: msg || "401" }
          : { kind: "next", fatal: "401", msg: msg || "401", err: null };
      }
      if (resp.status === 429) {
        return attempt.own
          ? { kind: "status", key: "ai.rateLimited", msg: "" }
          : { kind: "next", fatal: "429", msg: "429", err: null };
      }
      return { kind: "status", key: "ai.error", msg: msg || ("HTTP " + resp.status) };
    }
    const m = data.choices && data.choices[0] && data.choices[0].message;
    // thinking 模型兜底：content 空时看一眼 reasoning_content
    const text = m && (m.content || m.reasoning_content) || "";
    return { kind: "answer", text };
  }

  sendBtn.addEventListener("click", async () => {
    const q = qEl.value.trim();
    if (!q || !getKey()) return;
    sendBtn.disabled = true;
    answerEl.textContent = "";
    statusEl.textContent = tr("ai.thinking");
    try {
      let lastFatal = "net", lastMsg = "network";
      for (const a of attempts()) {
        const r = await askOne(a, q);
        if (r.kind === "answer") {
          statusEl.textContent = "";
          renderAnswer(r.text || tr("ai.empty"));
          return;
        }
        if (r.kind === "status") {
          statusEl.textContent = tr(r.key, { msg: r.msg });
          return;
        }
        if (r.kind === "keyview") {
          setKey("");   // 401 的坏 Key 留在本机没意义，清掉再让人重填
          showKeyView(tr(r.key, { msg: r.msg }));
          return;
        }
        lastFatal = r.fatal;
        lastMsg = r.msg;
      }
      // 所有尝试都失败：按最后一种失败类型给收尾文案
      if (lastFatal === "401") {
        showKeyView(tr("ai.sharedKeyDead", { msg: lastMsg }));
      } else if (lastFatal === "429") {
        statusEl.textContent = tr("ai.sharedRateLimited");
      } else {
        statusEl.textContent = tr("ai.netError", { msg: lastMsg });
      }
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

  // apply() 会把 #aiHelpCount 重填成 "0 / 500"，这里按当前输入长度再刷一次
  I18N.onChange(() => {
    syncButton();
    updateCount();
  });
})();

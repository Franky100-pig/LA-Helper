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
// 为什么有这么多 Provider（按序尝试，每条挂了自动换下一条）：
// · endless：群共享国际线路，Responses API；网关常间歇 530。
// · SiliconFlow：原本的主力，2026-11-15 共享 Key 余额耗尽（402）。
// · bigmodel(GLM)：2026-10 起 CORS 预检（OPTIONS）不再返回 ACAO 头，
//   浏览器直连全死在预检上（curl 却正常）；POST 与 Key 本身没坏。
// · Pollinations：免 Key 兜底，OPTIONS 带 ACAO、浏览器可直连 —— 上面三家
//   同时不可用时，它是最后一道保险（2026-11-15 加入时唯一真正能用的线路）。
// 用户自有 Key 优先生效，且只打对应那家平台，不跨平台瞎试。
// ---------------------------------------------------------------------------
(function initAiHelp() {
  const KEY_STORE = "la-glm-key";   // 沿用旧名：老用户已存的 GLM Key 不作废
  const MAX = 500;
  // 多轮对话：保留最近几轮问答作为 context，让用户能连续追问。
  // 4 轮 = 8 条消息，够连问 3-4 个小问题，又不至于把免费层的上下文撑爆。
  // 只在内存里，刷新页面即清空（不持久化，避免跨话题串味）。
  const MAX_TURNS = 4;

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
  // 国际线路：endless（群友共享的 OpenAI Responses API 网关）。
  // 只暴露 /responses，不走 chat/completions，所以请求体与解析都不同于上面两家。
  // 同为「群共享 Key」，随时可能失效/限流；介意就填自己的。
  const SHARED_KEY_ENDLESS = "sk-endless-e5jxn1LcTxz8Ej0x67zRJRVM8UtyW8QRihc_4OQnoXQ";
  // 免 Key 兜底线路：Pollinations 公共网关（无需注册，OPTIONS 预检带 ACAO，
  // 浏览器能直连）。值是「启用哨兵」而不是真 Key —— noAuth 线路不会把它当
  // Bearer 发出去（带了反而触发它的 402/FREE_LIMIT）。置空即可停用此线路。
  // 2026-11-15：SiliconFlow 共享 Key 余额耗尽(402)、GLM 预检被改坏、endless
  // 网关 530 —— 三家同时挂掉，它成了浏览器端唯一还能用的免费线路。
  const SHARED_KEY_POLLINATIONS = "public";

  // 群友给的第二条线路：跑在校园局域网 http://192.168.1.143:8000 的
  // aoody-oss-120b（同样是 Responses API，但路径带 /v1）。只在用户自己填了
  // sk-omlx-… 的 Key 时启用 —— 它是内网 http 地址，外网用户根本连不上，
  // 放进「共享线路」只会让每个人白撞一次超时。IP 换掉时可用 localStorage
  // 里的 la-ai-omlx-base 覆盖（例如同学换了个端口或开了别的隧道）。
  let OMLX_BASE = "http://192.168.1.143:8000/v1/responses";
  try {
    const saved = localStorage.getItem("la-ai-omlx-base");
    if (saved) OMLX_BASE = saved;
  } catch (_) { /* 存储被禁用就用默认值 */ }

  const PROVIDERS = [
    {
      id: "endless",
      endpoint: "https://service.makers.moe/responses",
      model: "endless",
      sharedKey: SHARED_KEY_ENDLESS,
      // OpenAI Responses API：body 用 input 数组，回答在 output[].content[].text。
      // 放在第一位：它是国际网络下唯一能直连的一条（另外两家都在国内）。
      api: "responses",
      extra: null,
    },
    {
      id: "siliconflow",
      endpoint: "https://api.siliconflow.cn/v1/chat/completions",
      model: "Qwen/Qwen3-8B",
      sharedKey: SHARED_KEY,
      // Qwen3 系是混合推理模型：显式关掉思考模式，否则非流式请求可能把
      // 回答写进 reasoning_content、content 反而为空
      api: "chat",
      extra: { enable_thinking: false },
    },
    {
      id: "bigmodel",
      endpoint: "https://open.bigmodel.cn/api/paas/v4/chat/completions",
      model: "glm-4-flash",
      sharedKey: SHARED_KEY_GLM,
      api: "chat",
      extra: null,
    },
    {
      // 免 Key 兜底：三家有 Key 的线路全挂时的最后一道保险。
      // noAuth=true → askOne 不发 Authorization 头；model "openai" 实测走
      // gpt-oss-20b，中文 + LaTeX 答疑质量可用。免费层限流约每 IP 45 秒 1 次。
      id: "pollinations",
      endpoint: "https://text.pollinations.ai/openai",
      model: "openai",
      sharedKey: SHARED_KEY_POLLINATIONS,
      noAuth: true,
      api: "chat",
      extra: null,
    },
    {
      id: "omlx",
      endpoint: OMLX_BASE,
      model: "aoody-oss-120b",
      // 没有公共 Key：只在用户自己粘贴 sk-omlx-… 时才会被 pickProvider 选中。
      sharedKey: "",
      api: "responses",
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
  const chatLogEl = el("aiChatLog");
  const newChatBtn = el("aiNewChat");
  const ctxHintEl = el("aiContextHint");

  // 任一平台还挂着公共 Key，就提示「你可以直接用，也可以换成自己的」
  const anyShared = !!(SHARED_KEY || SHARED_KEY_GLM || SHARED_KEY_ENDLESS);
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

  // 自有 Key 按前缀路由：endless 是 sk-endless-…、群友局域网是 sk-omlx-…
  // （这两条都走 Responses API），SiliconFlow 是其它 sk-…，GLM 是 id.secret。
  // 注意：PROVIDERS 顺序会变，这里必须按 id 取，不能用下标。
  const byId = (id) => PROVIDERS.find((p) => p.id === id);
  function pickProvider(key) {
    if (key.startsWith("sk-endless-")) return byId("endless");
    if (key.startsWith("sk-omlx-")) return byId("omlx");
    return key.startsWith("sk-") ? byId("siliconflow") : byId("bigmodel");
  }
  // 本次会话里「刚刚失败过」的线路：5 分钟内先跳过。
  // 没有它的话，每问一句都要先撞一遍死掉的网关（endless 530、余额 402 各
  // 浪费一个来回），用户会以为「AI 在发呆」。过期后自动重新尝试，
  // 免得平台恢复了还被记仇；全部都在冷却里时也照样全试一遍。
  const DOWN_TTL = 5 * 60 * 1000;
  const downUntil = Object.create(null);
  function markDown(id) { downUntil[id] = Date.now() + DOWN_TTL; }
  function isDown(p) { return (downUntil[p.id] || 0) > Date.now(); }

  // 本次「提问」要依次尝试的 (provider, key) 列表：
  // 有自己的 Key → 只用自己那份（Key 与平台绑定，不跨平台瞎试）；
  // 没有则按顺序试每个还有公共 Key 的平台，一个挂了自动换下一个。
  function attempts() {
    const own = memKey || readStore();
    if (own) return [{ provider: pickProvider(own), key: own, own: true }];
    const shared = PROVIDERS.filter((p) => p.sharedKey);
    const fresh = shared.filter((p) => !isDown(p));
    return (fresh.length ? fresh : shared)
      .map((p) => ({ provider: p, key: p.sharedKey, own: false }));
  }
  // 「现在有没有可用的 Key」——取第一条尝试的 Key；决定发送按钮是否可点
  function getKey() {
    const list = attempts();
    return list.length ? list[0].key : "";
  }

  // ---- 多轮对话上下文 ----------------------------------------------------
  // history 是一串 {role:"user"|"assistant", content} 消息（不含 system）。
  // 只有成功拿到回答才把「本轮提问 + 回答」成对压进去；失败/换 Key 都不记，
  // 免得把乱七八糟的失败塞进上下文误导下一轮。
  const history = [];
  function pushTurn(q, answer) {
    history.push({ role: "user", content: q });
    history.push({ role: "assistant", content: answer });
    // 只按完整轮次裁，保留最近 MAX_TURNS 轮（偶数条消息），不把一对拆散。
    const cap = MAX_TURNS * 2;
    if (history.length > cap) history.splice(0, history.length - cap);
  }
  function clearHistory() {
    history.length = 0;
    if (chatLogEl) chatLogEl.textContent = "";
    updateCtxHint();
  }
  function updateCtxHint() {
    if (!ctxHintEl) return;
    const turns = Math.floor(history.length / 2);
    ctxHintEl.textContent = turns > 0
      ? tr("ai.ctxHint", { n: turns, m: MAX_TURNS })
      : "";
  }
  // 把历史渲染成「你 / AI」气泡，用户能看见 AI 记住了什么。
  // 最后一轮的回答交给下面的 aiHelpAnswer（带 LaTeX 渲染），这里不重复画；
  // 但最后一轮的提问照画 —— 这样清空输入框后仍看得见「我刚问了什么」。
  function renderChatLog() {
    if (!chatLogEl) return;
    chatLogEl.textContent = "";
    const lastA = history.length - 2;   // 最后一轮 user 的下标
    for (let i = 0; i < history.length; i += 2) {
      const q = history[i], a = history[i + 1];
      bubble("user", tr("ai.you"), q.content);
      if (i < lastA) bubble("ai", tr("ai.aiLabel"), a.content);
    }
    function bubble(kind, who, text) {
      const row = document.createElement("div");
      row.className = "ai-bubble " + kind;
      const label = document.createElement("span");
      label.className = "ai-bubble-who";
      label.textContent = who;
      const body = document.createElement("span");
      body.className = "ai-bubble-text";
      body.textContent = text;
      row.appendChild(label);
      row.appendChild(body);
      chatLogEl.appendChild(row);
    }
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
    renderChatLog();      // 换 Key 回来时把已有对话重画一遍，不丢上下文
    updateCtxHint();
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

  // 「新话题」：把上下文清零，避免换话题后 AI 还带着上一题的包袱。
  if (newChatBtn) {
    newChatBtn.addEventListener("click", () => {
      clearHistory();
      answerEl.textContent = "";
      statusEl.textContent = "";
      qEl.value = "";
      updateCount();
      qEl.focus();
    });
  }

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
    // chat/completions 与 Responses API 的请求体不同：
    //   chat      → messages + max_tokens
    //   responses → input + max_output_tokens
    // 两者都吃同一种 [system, ...历史问答, 本轮提问] 消息序列 —— 这就是
    // context window：AI 看得见前几轮，才能回答「那这一步呢」「为什么」。
    const convo = [
      { role: "system", content: tr("ai.systemPrompt") },
    ].concat(history, [{ role: "user", content: q }]);
    const body = p.api === "responses"
      ? Object.assign({
          model: p.model,
          input: convo,
          max_output_tokens: 2000,
        }, p.extra || {})
      : Object.assign({
          model: p.model,
          messages: convo,
          temperature: 0.3,
          // 上限要留得比「回答长度」宽松：systemPrompt 允许写到几百字，
          // 而带 LaTeX 公式的答案 token 数远超字数（中英都不止），
          // 卡太紧会让回答在半句话处被截断。
          max_tokens: 2000,
        }, p.extra || {});
    try {
      // 免 Key 线路（Pollinations）绝不能带 Authorization：一旦带了，它会
      // 把这当成付费调用并回 402/FREE_LIMIT（实测）；不带才走免费层。
      const headers = { "Content-Type": "application/json" };
      if (!p.noAuth) headers["Authorization"] = "Bearer " + attempt.key;
      resp = await fetch(p.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      // fetch 抛 TypeError 通常是「预检失败 / 网络不通」，不是 Key 的问题。
      // 但有一种是能一眼确定的：https 页面请求 http 内网接口会被浏览器
      // 按「混合内容」直接拦掉；这时候让用户去查网络是纯误导。
      const httpsPage = typeof location !== "undefined" && location.protocol === "https:";
      if (httpsPage && /^http:\/\//.test(p.endpoint)) {
        return { kind: "next", fatal: "net", msg: tr("ai.mixedContent"), err, mixed: true };
      }
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
      // 402（余额不足）/ 403（无权限）/ 5xx（含 Cloudflare 530「隧道挂了」）
      // 都是「这个平台现在不能用」，跟用户的问题无关 —— 换下一条线路，
      // 不要把平台侧的故障当成整页的失败甩给用户。
      if (resp.status === 402 || resp.status === 403 || resp.status >= 500) {
        return { kind: "next", fatal: "down", msg: msg || ("HTTP " + resp.status), err: null };
      }
      return { kind: "status", key: "ai.error", msg: msg || ("HTTP " + resp.status) };
    }
    // 解析：chat 走 choices[].message.content（thinking 模型兜底看
    // reasoning_content）；Responses API 走 output[].content[].text，
    // 其中可能夹着 reasoning 等条目，只取 type=message 里的 output_text。
    let text = "";
    if (p.api === "responses") {
      for (const item of (data && data.output) || []) {
        if (item && item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c && c.type === "output_text") text += (c.text || "");
          }
        }
      }
    } else {
      const m = data.choices && data.choices[0] && data.choices[0].message;
      // thinking 模型兜底：content 空时看一眼 reasoning_content
      text = m && (m.content || m.reasoning_content) || "";
    }
    return { kind: "answer", text };
  }

  sendBtn.addEventListener("click", async () => {
    const q = qEl.value.trim();
    if (!q || !getKey()) return;
    sendBtn.disabled = true;
    // 注意：这里不清空 answerEl —— 上一轮回答要留着，等新回答回来再覆盖，
    // 否则「发送下一问」的瞬间上一轮答案会凭空消失。
    statusEl.textContent = tr("ai.thinking");
    try {
      let lastFatal = "net", lastMsg = "network";
      // 「平台明确说不能用了」的原因要单独留着：最后一次尝试很可能是
      // CORS/网络失败（比如 GLM 的预检被平台改坏），那会把真正的
      // 「HTTP 402 / 530」盖掉，收尾文案就变成误导性的「网络错误」。
      let lastDownMsg = "";
      let sawNetFail = false;
      let sawMixed = false;
      for (const a of attempts()) {
        const r = await askOne(a, q);
        if (r.kind === "answer") {
          statusEl.textContent = "";
          const text = r.text || tr("ai.empty");
          // 成功才把这一轮记进上下文（失败的乱码不进 history，免得污染下一问）
          pushTurn(q, text);
          renderChatLog();
          updateCtxHint();
          qEl.value = "";        // 清空上一句，方便直接写下一个问题
          renderAnswer(text);
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
        // 这条线路这次不行：记下来，接下来 5 分钟先跳过它
        markDown(a.provider.id);
        if (r.fatal === "down") lastDownMsg = r.msg;
        if (r.fatal === "net") sawNetFail = true;
        if (r.mixed) sawMixed = true;
        lastFatal = r.fatal;
        lastMsg = r.msg;
      }
      // 所有尝试都失败：按最后一种失败类型给收尾文案
      if (lastFatal === "401") {
        showKeyView(tr("ai.sharedKeyDead", { msg: lastMsg }));
      } else if (lastFatal === "429") {
        statusEl.textContent = tr("ai.sharedRateLimited");
      } else if (lastDownMsg) {
        // 只要有一条线路明确回了 402/530，就按「线路不可用」收尾 ——
        // 这比最后那条 CORS/网络失败更接近真相。
        statusEl.textContent = tr("ai.allDown", { msg: lastDownMsg });
      } else {
        statusEl.textContent = tr("ai.netError", { msg: lastMsg });
      }
      // 出现过 fetch 直接抛错时补一句 CORS 提示：自建/群共享网关常常
      // curl 能调通、却没有 Access-Control-Allow-Origin，网页直连必然失败。
      // 不提示的话用户会一直以为是自己网络坏了（或以为代码没接好）。
      // 混合内容是浏览器自己的规则，跟网关有没有 CORS 无关 —— 已经点名了
      // 就不再叠一句 CORS 提示，免得两条互相打架。
      if (sawNetFail && !sawMixed) statusEl.textContent += " " + tr("ai.corsHint");
    } finally {
      sendBtn.disabled = false;
      updateCount();
    }
  });

  // 启动：已存 Key 就直接进提问页，否则显示填 Key
  if (getKey()) showAskView(); else showKeyView("");
  // 从讲义「问 AI 助手」跳转过来时，URL 带 ?ask=预填问题：
  // 填进提问框并聚焦，用户接着写自己的疑问即可（typeof 守卫兼容测试沙箱）。
  if (typeof location !== "undefined" && location.search) {
    const m = /[?&]ask=([^&]*)/.exec(location.search);
    if (m) {
      try {
        qEl.value = decodeURIComponent(m[1]).slice(0, MAX);
        updateCount();
        setTimeout(() => qEl.focus(), 30);
      } catch (_) { /* 乱码参数就忽略，不影响正常提问 */ }
    }
  }
  updateCount();
})();

// ---------------------------------------------------------------------------
// 中文 / English 一键切换：与主页共用 localStorage["la-lang"]，切完立即重画。
// ---------------------------------------------------------------------------
(function initLang() {
  const btn = document.getElementById("langToggle");
  function syncButton() { if (btn) btn.textContent = I18N.toggleLabel(); }
  // apply() 会把 #aiHelpCount 的文本重填成 i18n 模板（"{n} / 500" 里的 {n} 不会
  // 被替换，因为它是 data-i18n 而非带变量的 t 调用）。这里按输入长度补一次真实计数。
  function refreshCount() {
    const q = document.getElementById("aiHelpQ");
    const c = document.getElementById("aiHelpCount");
    if (q && c) c.textContent = I18N.t("ai.count", { n: q.value.length });
  }

  I18N.apply(document);
  syncButton();
  refreshCount();

  if (btn) btn.addEventListener("click", () => { I18N.toggle(); });

  I18N.onChange(() => {
    syncButton();
    refreshCount();
  });
})();

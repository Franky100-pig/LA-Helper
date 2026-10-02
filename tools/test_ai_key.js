// AI 答疑的 Key 解析逻辑：公共 Key 与用户自有 Key 的优先级、失效分支。
//
// 共享 Key 是这个功能能不能被用起来的关键，所以「用户填了自己的之后会不会被
// 公共 Key 顶掉」「公共 Key 挂了会不会让整页瘫掉」必须钉死。
//
// 同样用 vm + 桩 DOM 把 ai-help.js 真跑起来（本机没有无头浏览器）。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WEB = path.join(__dirname, "..", "web");

let pass = 0;
const fails = [];
function ok(cond, label) {
  if (cond) pass++; else fails.push(label);
}
function eq(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b),
     `${label} — 期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}`);
}

function makeEl(id) {
  return {
    id, value: "", hidden: false, disabled: false, textContent: "", innerHTML: "",
    className: "", type: "", placeholder: "", href: "", title: "",
    style: { display: "" }, dataset: {}, classList: { add() {}, remove() {} },
    addEventListener(ev, fn) { (this._l = this._l || {})[ev] = fn; },
    fire(ev, arg) { if (this._l && this._l[ev]) return this._l[ev](arg || {}); },
    appendChild() {}, removeChild() {}, setAttribute() {}, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
  };
}

/**
 * 起一个跑着 ai-help.js 的沙箱。
 * sharedKey 用来测两种模式（启用 / 未启用），因为 SHARED_KEY 是源码里的常量。
 */
function boot({ sharedKey = "sk-public-test", stored = null, fetchImpl = null } = {}) {
  const els = {};
  ["aiHelpKeyBox", "aiHelpAskBox", "aiHelpKeyIn", "aiHelpSaveKey", "aiHelpKeyMsg",
   "aiHelpQ", "aiHelpCount", "aiHelpSend", "aiHelpChangeKey", "aiHelpAnswer",
   "aiHelpStatus", "aiHelpSharedNote", "langToggle"].forEach((id) => {
    els[id] = makeEl(id);
  });
  els.aiHelpQ.value = "why?";

  const store = {};
  if (stored != null) store["la-glm-key"] = stored;
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };

  const calls = [];
  const win = { katex: null };
  // initTheme 会读 <html data-theme>
  const docEl = makeEl("html");
  docEl.getAttribute = () => "dark";
  const sandbox = {
    window: win,
    document: {
      documentElement: docEl,
      getElementById: (id) => els[id] || null,
      createElement: () => makeEl("created"),
      createTextNode: (t) => ({ textContent: t }),
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    console: { warn() {}, error() {}, log() {} },
    setTimeout: (fn) => { return 0; },     // 不真的 focus，避免挂起
    clearTimeout() {},
    navigator: { language: "zh-CN" },
    fetch: fetchImpl || (async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: "ok" } }] }) };
    }),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(fs.readFileSync(path.join(WEB, "i18n.js"), "utf8"), sandbox, { filename: "i18n.js" });
  let src = fs.readFileSync(path.join(WEB, "ai-help.js"), "utf8");
  // SHARED_KEY 是源码常量，测两种模式就替换这一个值。
  // 用正则而不是字面量匹配：真实 key 一旦填进去，字面量 `""` 就不存在了。
  const before = src;
  src = src.replace(/const SHARED_KEY = "[^"]*";/,
                    `const SHARED_KEY = ${JSON.stringify(sharedKey)};`);
  if (src === before) throw new Error("没找到 SHARED_KEY 常量，源码结构变了？");
  // getKey/setKey/... 都关在 initAiHelp 的 IIFE 里，外部看不见。
  // 所以把导出语句**插进 IIFE 内部**（它还在同一层作用域里）。
  const IIFE_END = "  // 启动：已存 Key 就直接进提问页，否则显示填 Key";
  const at = src.indexOf(IIFE_END);
  if (at < 0) throw new Error("找不到 initAiHelp 的插入点");
  src = src.slice(0, at) + `
  globalThis.__t = { getKey, setKey, hasOwnKey, showKeyView, showAskView,
                      updateCount, SHARED_KEY };
` + src.slice(at);
  vm.runInContext(src, sandbox, { filename: "ai-help.js" });

  return { t: sandbox.__t, els, store, calls, I18N: sandbox.window.LA_I18N };
}

// ==== 优先级：自己存的 > 公共的 ============================================
{
  const s = boot({ stored: "sk-mine" });
  eq(s.t.getKey(), "sk-mine", "1 填过自己的 Key 就用自己的，不被公共 Key 顶掉");
  eq(s.t.hasOwnKey(), true, "1 hasOwnKey 为真");
}
{
  const s = boot({ sharedKey: "sk-public", stored: null });
  eq(s.t.getKey(), "sk-public", "2 没填过就用公共 Key");
  eq(s.t.hasOwnKey(), false, "2 hasOwnKey 为假（用于区分错误文案）");
}
{
  // SHARED_KEY 留空 = 未启用：必须完全回到「必须自己填」的旧行为
  const s = boot({ sharedKey: "", stored: null });
  eq(s.t.getKey(), "", "3 未启用公共 Key 时没有可用 Key");
  eq(s.els.aiHelpKeyBox.hidden, false, "3 停在填 Key 页");
  eq(s.els.aiHelpAskBox.hidden, true, "3 不显示提问框");
  eq(s.els.aiHelpSharedNote.hidden, true, "3 公共 Key 提示块不出现");
}
{
  const s = boot({ sharedKey: "sk-public", stored: null });
  eq(s.els.aiHelpAskBox.hidden, false, "4 启用公共 Key 时直接进提问页");
  eq(s.els.aiHelpKeyBox.hidden, true, "4 不显示填 Key 页");
  eq(s.els.aiHelpSharedNote.hidden, false, "4 公共 Key 提示块出现");
  eq(s.els.aiHelpSend.disabled, false, "4 有 Key + 有问题 → 提问按钮可点");
}

// ==== 存入自己的 Key 之后，它会优先生效 ====================================
{
  const s = boot({ sharedKey: "sk-public" });
  s.els.aiHelpKeyIn.value = "  sk-mine  ";
  s.els.aiHelpSaveKey.fire("click");
  eq(s.store["la-glm-key"], "sk-mine", "5 存进本机时会去掉首尾空格");
  eq(s.t.getKey(), "sk-mine", "5 之后优先用自己那份");
  eq(s.els.aiHelpAskBox.hidden, false, "5 直接进提问页");
}

// ==== 「更换 Key」不该把人彻底挡在门外 ======================================
{
  const s = boot({ sharedKey: "sk-public", stored: "sk-mine" });
  s.els.aiHelpChangeKey.fire("click");
  eq(s.store["la-glm-key"], "", "6 换 Key 会清掉自己那份");
  eq(s.t.hasOwnKey(), false, "6 已经没有自己的 Key");
  eq(s.t.getKey(), "sk-public", "6 但公共 Key 仍然可用 ——「更换」≠「禁用」");
}

// ==== 保存时留空 = 用公共 Key，而不是报错 ==================================
{
  const s = boot({ sharedKey: "sk-public" });
  s.els.aiHelpKeyIn.value = "";
  s.els.aiHelpSaveKey.fire("click");
  eq(s.els.aiHelpAskBox.hidden, false, "7 留空且有公共 Key → 视为「用公共的」，不拦人");
}
{
  const s = boot({ sharedKey: "" });
  s.els.aiHelpKeyIn.value = "";
  s.els.aiHelpSaveKey.fire("click");
  ok(s.els.aiHelpKeyMsg.textContent.length > 0, "7 没有公共 Key 时留空要给出提示");
  eq(s.els.aiHelpAskBox.hidden, true, "7 且不放行");
}

// ==== 失效处理：区分「我的 Key 坏了」和「公共 Key 坏了」====================
async function sendAndSee(fetchImpl) {
  const s = boot({ sharedKey: "sk-public", stored: null, fetchImpl });
  s.els.aiHelpQ.value = "why?";
  await s.els.aiHelpSend.fire("click");
  return s;
}
function responder(status) {
  return async () => ({
    ok: false, status,
    json: async () => ({ error: { message: "boom" } }),
  });
}
(async () => {

// 公共 Key 401 → 提示「公共 Key 失效，请填自己的」，而不是说「你的 Key 无效」
{
  const s = await sendAndSee(responder(401));
  const msg = s.els.aiHelpKeyMsg.textContent;
  ok(/公共 Key|共享/.test(msg), `8 公共 Key 401 应提示公共 Key 失效，实际：${msg}`);
  ok(!/Key 无效/.test(msg), `8 不该说成「你的 Key 无效」，实际：${msg}`);
  eq(s.els.aiHelpKeyBox.hidden, false, "8 把用户推回填 Key 页");
}
// 自己的 Key 401 → 照旧说自己的 Key 无效
{
  const s = boot({ sharedKey: "sk-public", stored: "sk-mine", fetchImpl: responder(401) });
  await s.els.aiHelpSend.fire("click");
  const msg = s.els.aiHelpKeyMsg.textContent;
  ok(!/公共 Key|共享/.test(msg), `9 自己的 Key 401 不该提公共 Key，实际：${msg}`);
}
// 公共 Key 429 → 提示额度打满（因为此时用户唯一能做的就是换 Key）
{
  const s = await sendAndSee(responder(429));
  const msg = s.els.aiHelpStatus.textContent;
  ok(/额度|quota/i.test(msg), `10 公共 Key 429 应提示额度打满，实际：${msg}`);
}
// 自己的 Key 429 → 照旧提示稍等重试
{
  const s = boot({ sharedKey: "sk-public", stored: "sk-mine", fetchImpl: responder(429) });
  await s.els.aiHelpSend.fire("click");
  const msg = s.els.aiHelpStatus.textContent;
  ok(!/额度打满|quota is temporarily used up/.test(msg),
     `11 自己的 Key 429 不该说「额度打满」，实际：${msg}`);
}
// 请求确实带上了 Key
{
  const s = await sendAndSee(null);
  eq(s.calls.length, 1, "12 发起了一次请求");
  ok(/Bearer sk-public/.test(s.calls[0].opts.headers.Authorization),
     `12 请求头应带上公共 Key，实际：${s.calls[0].opts.headers.Authorization}`);
}
// 发送按钮在没有 Key 时保持禁用
{
  const s = boot({ sharedKey: "" });
  s.t.updateCount();
  eq(s.els.aiHelpSend.disabled, true, "13 问题为空时也禁用");
}

// ==== 长度上限：JS 的 MAX 与 HTML 的 maxlength 必须一致 ====================
// 这个数字散在四处：ai-help.js 的 MAX、ai-help.html 的 maxlength、
// i18n 的 "{n} / 500"、以及 HTML 里的默认文本。改一处漏三处的话，
// 用户会遇到「打不到上限就被截断」或「计数器显示的和实际不符」。
{
  const html = fs.readFileSync(path.join(WEB, "ai-help.html"), "utf8");
  const js = fs.readFileSync(path.join(WEB, "ai-help.js"), "utf8");

  const maxJs = Number((js.match(/const MAX = (\d+);/) || [])[1]);
  const maxAttr = Number((html.match(/id="aiHelpQ"[^>]*maxlength="(\d+)"/) || [])[1]);
  ok(Number.isFinite(maxJs) && maxJs > 0, "14 能在 ai-help.js 里读到 MAX");
  ok(Number.isFinite(maxAttr) && maxAttr > 0, "14 能在 ai-help.html 里读到 maxlength");
  eq(maxAttr, maxJs, "14 textarea 的 maxlength 与 JS 的 MAX 一致");

  // i18n 的计数字符串
  const i18nSrc = fs.readFileSync(path.join(WEB, "i18n.js"), "utf8");
  const counts = [...i18nSrc.matchAll(/"ai\.count":\s*"\{n\} \/ (\d+)"/g)].map((m) => Number(m[1]));
  eq(counts.length, 2, "14 中英两处都有 ai.count");
  for (const n of counts) {
    eq(n, maxJs, `14 i18n 里的计数器上限（${n}）与 MAX 一致`);
  }
  // HTML 里的默认文本也要跟上（i18n 生效前用户会看到它）
  const dflt = (html.match(/id="aiHelpCount"[^>]*>([^<]*)</) || [])[1];
  ok(dflt && dflt.includes(String(maxJs)),
     `14 HTML 默认文本里的上限应含 ${maxJs}，实际：${dflt}`);

  // 真正生效的边界：到 MAX-1 能发，超过 MAX 按钮禁用
  const s = boot({ sharedKey: "sk-public" });
  s.els.aiHelpQ.value = "x".repeat(maxJs);
  s.t.updateCount();
  eq(s.els.aiHelpSend.disabled, false, "14 正好等于上限时仍可发送");
  s.els.aiHelpQ.value = "x".repeat(maxJs + 1);
  s.t.updateCount();
  eq(s.els.aiHelpSend.disabled, true, "14 超过上限时禁用发送");
  eq(s.els.aiHelpCount.textContent, `${maxJs + 1} / ${maxJs}`, "14 计数器显示当前长度 / 上限");
}

// ==== 回答长度：max_tokens 必须留得比 systemPrompt 允许的长度宽松 ========
// 踩过的坑：max_tokens 曾经是 600，而 prompt 说「可以写到 300 字」。
// 带 LaTeX 的答案 token 数远超字数（$...$、$$...$$、\\frac 都是多 token），
// 于是回答会在半句话处被截断 —— 表现为「AI 突然不说了」，很容易被误判成
// 模型故障或网络问题。
{
  const js2 = fs.readFileSync(path.join(WEB, "ai-help.js"), "utf8");
  const mt = Number((js2.match(/max_tokens:\s*(\d+)/) || [])[1]);
  ok(Number.isFinite(mt), "15 读得到 max_tokens");
  ok(mt >= 2000, `15 max_tokens 应 >= 2000（实际 ${mt}）—— 太小会把回答截断在半句`);

  // prompt 里承诺的字数也要同步放宽，且中英两处都要改
  const i18n2 = fs.readFileSync(path.join(WEB, "i18n.js"), "utf8");
  const prompts = [...i18n2.matchAll(/"ai\.systemPrompt":\s*"([^"]*)"/g)].map((m) => m[1]);
  eq(prompts.length, 2, "15 中英各有一条 systemPrompt");
  ok(prompts.every((p) => /600/.test(p)),
     "15 两条 prompt 都应提到 600 字/词（与放宽后的上限一致）");
  ok(prompts.every((p) => !/300 字|300 words/.test(p)),
     "15 旧的 300 字说法应已从 prompt 中移除");
}

console.log(`ai-key: ${pass} 项通过，${fails.length} 项失败`);
if (fails.length) {
  console.log("FAIL");
  for (const f of fails) console.log("  -", f);
  process.exit(1);
}
console.log("OK：公共 Key 优先级 / 更换语义 / 失效分支 均符合预期");

})();

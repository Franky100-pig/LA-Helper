#!/usr/bin/env node
/**
 * test_bridge_fallback.js — la-bridge.js 的换源逻辑测试。
 *
 * 背景：cdn.jsdelivr.net 在大陆时好时坏，最糟的形态是「挂起不报错」。旧的桥
 * 是同步 <script> 标签，一挂起，后面的 la-bridge/app 全部不执行，用户永远停在
 * 「加载中」。新桥动态加载、逐源限时、失败换源。
 *
 * 现在的源顺序：同源 "./pyodide/"（fetch_pyodide.py 预放的最小运行时）永远第一，
 * jsDelivr 三源兜底；全部失败给「重新加载引擎」按钮；远程源记住上次成功者优先试。
 *
 * 这组测试用 vm + 桩 DOM 真正跑生成的 la-bridge.js（不是 grep 源码），覆盖：
 *   1) 同源正常 → ready（同源 indexURL）
 *   2) 同源脚本挂起 → 超时换第二源 → ready（关键场景：旧版在这里永久卡死）
 *   3) 同源脚本报错 → 换源 → ready
 *   4) 核心加载成功但 sympy 失败 → 保留 loader、同 loader 换 indexURL → ready
 *   5) 全部源失败 → 不 ready、allfail 文案 + 重试按钮；点按钮（网络恢复）→ ready
 *   6) 成功源记忆：远程源成功后写入 localStorage，下次优先试；同源不写、且永远第一
 *   7) 构建产物检查：index.html 无写死的 pyodide <script>、有三个 preconnect、
 *      bridge 源清单首位是 ./pyodide/
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const pass = [];
const fails = [];
let n = 0;
function ok(cond, label) {
  n++;
  if (cond) pass.push(label);
  else fails.push(label);
}
function eq(a, b, label) {
  ok(a === b, `${label}（got ${JSON.stringify(a)}，want ${JSON.stringify(b)}）`);
}

// ---- 取生成的 la-bridge.js（临时目录构建，不碰仓库内产物）------------------
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "la-bridge-test-"));
const PYTHON = process.env.PYTHON || "python3";
execFileSync(PYTHON, [path.join(ROOT, "tools", "build_preview.py")], {
  cwd: ROOT,
  env: { ...process.env, LA_PREVIEW_OUT: outDir },
  stdio: ["ignore", "ignore", "inherit"],
});
const BRIDGE = fs.readFileSync(path.join(outDir, "la-bridge.js"), "utf8");
const BUILT_INDEX = fs.readFileSync(path.join(outDir, "index.html"), "utf8");

const BASE = "https://la.test/index.html";
const LOCAL = "./pyodide/";
const CDN_SOURCES = [
  "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
  "https://fastly.jsdelivr.net/pyodide/v0.26.2/full/",
  "https://gcore.jsdelivr.net/pyodide/v0.26.2/full/",
];

// ---- 桩 DOM + vm 启动器 ----------------------------------------------------
/**
 * scenario.scripts: { [host]: "ok" | "err" | "hang" }
 * scenario.sympyFailOn: [indexURL, ...]  — 这些 indexURL 上 loadPackage("sympy") 抛错
 * scenario.saved: 预置 localStorage["la-pyodide-src"]
 */
function boot(scenario) {
  const statusEl = {
    _text: "",
    children: [],
    // 与真实 DOM 一致：设 textContent 会清掉子节点（重试按钮就挂在里面）
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join("");
    },
    set textContent(v) {
      this._text = String(v);
      this.children = [];
    },
    appendChild(c) { this.children.push(c); },
  };
  const computeBtn = { disabled: true };
  const scriptLoads = [];   // 实际 appendChild 的脚本 URL
  const loaderCalls = [];   // loadPyodide 收到的 indexURL

  function makeInstance(indexURL) {
    return {
      loadPackage: async (pkg) => {
        if (pkg === "sympy" && (scenario.sympyFailOn || []).includes(indexURL)) {
          throw new Error("sympy fail on " + indexURL);
        }
      },
      FS: { mkdir() {}, writeFile() {} },
      runPython: (code) => (code.includes("_la_dispatch") ? "{}" : ""),
    };
  }

  const document = {
    baseURI: BASE,
    getElementById: (id) => {
      if (id === "engineStatus") return statusEl;
      if (id === "compute") return computeBtn;
      if (id === "engineRetry") {
        return statusEl.children.find((c) => c.id === "engineRetry") || null;
      }
      return null;
    },
    createElement: () => ({
      onload: null, onerror: null, src: "", id: "", type: "",
      textContent: "", className: "", onclick: null,
    }),
    head: {
      appendChild: (s) => {
        scriptLoads.push(s.src);
        const host = new URL(s.src, BASE).host;
        const plan = (scenario.scripts && scenario.scripts[host]) || "ok";
        if (plan === "ok") {
          setTimeout(() => {
            // 模拟 pyodide.js 定义的全局 loadPyodide（各源的文件是同一份）
            sandbox.window.loadPyodide = (cfg) => {
              loaderCalls.push(cfg.indexURL);
              return Promise.resolve(makeInstance(cfg.indexURL));
            };
            s.onload();
          }, 5);
        } else if (plan === "err") {
          setTimeout(() => s.onerror(), 5);
        }
        // "hang"：什么都不做 —— 正是线上那种最坏的故障形态
      },
    },
  };

  const store = {};
  const localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  if (scenario.saved) store["la-pyodide-src"] = scenario.saved;

  const sandbox = {
    console: { warn() {} },
    setTimeout,
    clearTimeout,
    URL,
    document,
    localStorage,
  };
  sandbox.window = sandbox;
  sandbox.window.LA_BOOT_TIMEOUT_MS = 60;   // 测试里把换源超时调短
  sandbox.window.LA_I18N = { t: (k, vars) => k + (vars ? JSON.stringify(vars) : "") };
  sandbox.window.LA_CORE_FILES = { "engine.py": "# stub" };
  vm.createContext(sandbox);

  // 末行 `window.LA._bootPromise = boot();` 的完成值就是 boot 的 promise ——
  // await 它直到整个换源流程结束
  const done = vm.runInContext(BRIDGE, sandbox, { filename: "la-bridge.js" });
  return {
    done,
    sandbox,
    statusEl,
    computeBtn,
    scriptLoads,
    loaderCalls,
    store,
    hostOf: (u) => new URL(u, BASE).host,
  };
}

(async () => {
  // ==== 1) 同源正常 ==========================================================
  {
    const a = boot({ scripts: {} });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "1 同源正常 → ready");
    eq(a.scriptLoads.length, 1, "1 只加载了一次 pyodide.js");
    eq(a.loaderCalls.length, 1, "1 只开了一个 Pyodide 实例");
    eq(a.hostOf(a.loaderCalls[0]), "la.test", "1 用的是同源 ./pyodide/");
    ok(a.loaderCalls[0].endsWith("/pyodide/"), "1 indexURL 落在同源 pyodide/ 目录");
    ok(a.statusEl.textContent.includes("engine.ready"), "1 状态为 ready");
    eq(a.computeBtn.disabled, false, "1 计算按钮已解禁");
  }

  // ==== 2) 同源挂起 → 超时换源（旧版会永久卡死的场景）========================
  {
    const t0 = Date.now();
    const a = boot({
      scripts: { "la.test": "hang" },
    });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "2 同源挂起 → 换到 CDN 源 → ready");
    ok(Date.now() - t0 < 5000, "2 超时切换是毫秒级的（不是等浏览器自己超时）");
    eq(a.hostOf(a.loaderCalls[0]), "cdn.jsdelivr.net", "2 第二源接手");
    ok(a.statusEl.textContent.includes("engine.ready"), "2 最终状态 ready");
  }

  // ==== 3) 同源报错（onerror 正常触发）=======================================
  {
    const a = boot({ scripts: { "la.test": "err" } });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "3 同源 onerror → 换源 → ready");
    eq(a.hostOf(a.loaderCalls[0]), "cdn.jsdelivr.net", "3 第二源接手");
  }

  // ==== 4) 核心成功但 sympy 失败 → 保留 loader 换 indexURL ====================
  {
    const a = boot({
      scripts: {},   // 脚本全部正常 —— 只下载一次
      sympyFailOn: ["https://la.test/pyodide/"],
    });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "4 sympy 在同源失败 → 换 indexURL → ready");
    eq(a.scriptLoads.length, 1, "4 pyodide.js 只下载一次（loader 被保留复用）");
    eq(a.loaderCalls.length, 2, "4 用同一 loader 开了第二个实例");
    eq(a.hostOf(a.loaderCalls[1]), "cdn.jsdelivr.net", "4 第二个实例用第二源");
  }

  // ==== 5) 全部源失败 → allfail + 重试按钮；点按钮（恢复）→ ready =============
  {
    const scenario = {
      scripts: {
        "la.test": "err",
        "cdn.jsdelivr.net": "err",
        "fastly.jsdelivr.net": "err",
        "gcore.jsdelivr.net": "err",
      },
    };
    const a = boot(scenario);
    await a.done;
    ok(a.sandbox.window.LA.ready === false, "5 全失败 → 不 ready");
    ok(a.sandbox.window.LA.error != null, "5 错误被记录到 LA.error");
    ok(a.statusEl.textContent.includes("engine.allfail"),
       "5 状态给出 allfail 文案（而不是永远加载中）");
    ok(a.computeBtn.disabled === true, "5 计算按钮保持禁用");
    const btn = a.statusEl.children.find((c) => c.id === "engineRetry");
    ok(!!btn, "5 出现了重试按钮");
    ok(btn && btn.textContent.includes("engine.retry"), "5 按钮文案走 i18n");
    // 网络恢复后点重试 —— 第二次 boot 走通
    for (const k of Object.keys(scenario.scripts)) scenario.scripts[k] = "ok";
    btn.onclick();
    await a.sandbox.window.LA._bootPromise;
    ok(a.sandbox.window.LA.ready === true, "5 点重试按钮 → 重新加载成功 → ready");
    eq(a.computeBtn.disabled, false, "5 重试成功后计算按钮解禁");
  }

  // ==== 6) 成功源记忆 ========================================================
  {
    // 6a) 同源成功 → 不写 localStorage（同源永远第一，没必要记）
    const a = boot({ scripts: {} });
    await a.done;
    ok(!("la-pyodide-src" in a.store), "6a 同源成功不写 la-pyodide-src");
  }
  {
    // 6b) 同源失败、fastly 成功 → 记住 fastly
    const a = boot({
      scripts: { "la.test": "err", "cdn.jsdelivr.net": "err" },
    });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "6b fastly 接手 → ready");
    eq(a.hostOf(a.loaderCalls[0]), "fastly.jsdelivr.net", "6b 轮到 fastly");
    eq(a.store["la-pyodide-src"], CDN_SOURCES[1], "6b 记住了 fastly 完整源");
  }
  {
    // 6c) 记住了 fastly → 下次同源又挂时，fastly 排在 cdn 前面
    const a = boot({
      scripts: { "la.test": "err" },
      saved: CDN_SOURCES[1],
    });
    await a.done;
    eq(a.hostOf(a.loaderCalls[0]), "fastly.jsdelivr.net",
       "6c 记住的源优先于清单里的 cdn");
  }
  {
    // 6d) 记忆只认清单内的源（防被篡改的 localStorage 引去野站）：
    //     saved 是清单外的野站 → 忽略，三个 CDN 都可达时仍按清单顺序先试 cdn
    const a = boot({
      scripts: { "la.test": "err" },
      saved: "https://evil.example.com/pyodide/",
    });
    await a.done;
    eq(a.hostOf(a.loaderCalls[0]), "cdn.jsdelivr.net",
       "6d 清单外的 saved 被忽略，仍按清单顺序走");
  }

  // ==== 7) 构建产物检查 ======================================================
  {
    ok(!/script src="https:\/\/[^"]*pyodide\.js/.test(BUILT_INDEX),
       "7 index.html 不再写死 pyodide.js <script>（挂起会卡死后续脚本）");
    for (const host of ["cdn.jsdelivr.net", "fastly.jsdelivr.net", "gcore.jsdelivr.net"]) {
      ok(BUILT_INDEX.includes(`href="https://${host}"`),
         `7 有 ${host} 的 preconnect`);
    }
    ok(!BUILT_INDEX.includes('href="."'), "7 同源 ./pyodide/ 不产 preconnect");
    // la-bridge.js 仍要带版本号（缓存 bust 依赖它）
    ok(/la-bridge\.js\?v=[a-f0-9]{8}/.test(BUILT_INDEX), "7 la-bridge.js 带 ?v");
    // 源清单：同源首位 + 三个 CDN 兜底
    const m = BRIDGE.match(/PYODIDE_SOURCES = (\[[^\]]*\])/);
    ok(!!m, "7 bridge 里有 PYODIDE_SOURCES");
    if (m) {
      const srcs = JSON.parse(m[1]);
      eq(srcs[0], LOCAL, "7 源清单首位是 ./pyodide/");
      eq(srcs.length, 1 + CDN_SOURCES.length, "7 共 4 个源");
      for (const c of CDN_SOURCES) ok(srcs.includes(c), `7 清单含 ${c}`);
    }
    ok(BRIDGE.includes("engineRetry"), "7 bridge 含重试按钮逻辑");
    ok(BRIDGE.includes("la-pyodide-src"), "7 bridge 含成功源记忆逻辑");
  }

  console.log(`bridge-fallback: ${pass.length}/${n} 项通过`);
  if (fails.length) {
    console.log("FAIL");
    for (const f of fails) console.log("  -", f);
    process.exit(1);
  }
  console.log("OK：同源优先/换源/超时/重试/成功源记忆/构建产物全部符合预期");
  // bridge 里的 withTimeout 会留下 120s 的长定时器，不显式退出的话 node 要等
  // 它们自然超时才结束（CI 白等两分钟）。
  process.exit(0);
})().catch((e) => {
  console.error("测试执行异常：", e);
  process.exit(1);
});

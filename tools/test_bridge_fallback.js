#!/usr/bin/env node
/**
 * test_bridge_fallback.js — la-bridge.js 的换源逻辑测试。
 *
 * 背景：cdn.jsdelivr.net 在大陆时好时坏，最糟的形态是「挂起不报错」。旧的桥
 * 是同步 <script> 标签，一挂起，后面的 la-bridge/app 全部不执行，用户永远停在
 * 「加载中」。新桥动态加载、逐源限时、失败换源。
 *
 * 这组测试用 vm + 桩 DOM 真正跑生成的 la-bridge.js（不是 grep 源码），覆盖：
 *   1) 首源正常 → ready
 *   2) 首源脚本挂起 → 超时换第二源 → ready（关键场景：旧版在这里永久卡死）
 *   3) 首源脚本报错 → 换源 → ready
 *   4) 核心加载成功但 sympy 失败 → 保留 loader、同 loader 换 indexURL → ready
 *   5) 全部源失败 → 不 ready、状态给出 allfail 文案
 *   6) 构建产物检查：index.html 无写死的 pyodide <script>、有三个 preconnect
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

const SOURCES = [
  "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/",
  "https://fastly.jsdelivr.net/pyodide/v0.26.2/full/",
  "https://gcore.jsdelivr.net/pyodide/v0.26.2/full/",
];

// ---- 桩 DOM + vm 启动器 ----------------------------------------------------
/**
 * scenario.scripts: { [host]: "ok" | "err" | "hang" }
 * scenario.sympyFailOn: [indexURL, ...]  — 这些 indexURL 上 loadPackage("sympy") 抛错
 */
function boot(scenario) {
  const statusEl = { textContent: "" };
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
    getElementById: (id) =>
      id === "engineStatus" ? statusEl : id === "compute" ? computeBtn : null,
    createElement: () => ({ onload: null, onerror: null, src: "" }),
    head: {
      appendChild: (s) => {
        scriptLoads.push(s.src);
        const host = new URL(s.src).host;
        const plan = (scenario.scripts && scenario.scripts[host]) || "ok";
        if (plan === "ok") {
          setTimeout(() => {
            // 模拟 pyodide.js 定义的全局 loadPyodide（三个域名的文件是同一份）
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

  const sandbox = {
    console: { warn() {} },
    setTimeout,
    clearTimeout,
    URL,
    document,
  };
  sandbox.window = sandbox;
  sandbox.window.LA_BOOT_TIMEOUT_MS = 60;   // 测试里把换源超时调短
  sandbox.window.LA_I18N = { t: (k, vars) => k + (vars ? JSON.stringify(vars) : "") };
  sandbox.window.LA_CORE_FILES = { "engine.py": "# stub" };
  vm.createContext(sandbox);

  // IIFE 的完成值就是 boot 的 promise —— await 它直到整个换源流程结束
  const done = vm.runInContext(BRIDGE, sandbox, { filename: "la-bridge.js" });
  return {
    done,
    sandbox,
    statusEl,
    computeBtn,
    scriptLoads,
    loaderCalls,
    hostOf: (u) => new URL(u).host,
  };
}

(async () => {
  // ==== 1) 首源正常 ==========================================================
  {
    const a = boot({ scripts: {} });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "1 首源正常 → ready");
    eq(a.scriptLoads.length, 1, "1 只加载了一次 pyodide.js");
    eq(a.loaderCalls.length, 1, "1 只开了一个 Pyodide 实例");
    eq(a.hostOf(a.loaderCalls[0]), "cdn.jsdelivr.net", "1 用的是首选源");
    ok(a.statusEl.textContent.includes("engine.ready"), "1 状态为 ready");
    eq(a.computeBtn.disabled, false, "1 计算按钮已解禁");
  }

  // ==== 2) 首源挂起 → 超时换源（旧版会永久卡死的场景）========================
  {
    const t0 = Date.now();
    const a = boot({
      scripts: { "cdn.jsdelivr.net": "hang" },
    });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "2 首源挂起 → 换到第二源 → ready");
    ok(Date.now() - t0 < 5000, "2 超时切换是毫秒级的（不是等浏览器自己超时）");
    eq(a.hostOf(a.loaderCalls[0]), "fastly.jsdelivr.net", "2 第二源接手");
    ok(a.statusEl.textContent.includes("engine.ready"), "2 最终状态 ready");
  }

  // ==== 3) 首源报错（onerror 正常触发）=======================================
  {
    const a = boot({ scripts: { "cdn.jsdelivr.net": "err" } });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "3 首源 onerror → 换源 → ready");
    eq(a.hostOf(a.loaderCalls[0]), "fastly.jsdelivr.net", "3 第二源接手");
  }

  // ==== 4) 核心成功但 sympy 失败 → 保留 loader 换 indexURL ====================
  {
    const a = boot({
      scripts: {},   // 脚本全部正常 —— 只下载一次
      sympyFailOn: [SOURCES[0]],
    });
    await a.done;
    ok(a.sandbox.window.LA.ready === true, "4 sympy 在首源失败 → 换 indexURL → ready");
    eq(a.scriptLoads.length, 1, "4 pyodide.js 只下载一次（loader 被保留复用）");
    eq(a.loaderCalls.length, 2, "4 用同一 loader 开了第二个实例");
    eq(a.hostOf(a.loaderCalls[1]), "fastly.jsdelivr.net", "4 第二个实例用第二源");
  }

  // ==== 5) 全部源失败 =========================================================
  {
    const a = boot({
      scripts: Object.fromEntries(SOURCES.map((s) => [new URL(s).host, "err"])),
    });
    await a.done;
    ok(a.sandbox.window.LA.ready === false, "5 全失败 → 不 ready");
    ok(a.sandbox.window.LA.error != null, "5 错误被记录到 LA.error");
    ok(a.statusEl.textContent.includes("engine.allfail"), "5 状态给出 allfail 文案（而不是永远加载中）");
    ok(a.computeBtn.disabled === true, "5 计算按钮保持禁用");
  }

  // ==== 6) 构建产物：index.html 不再有写死的 pyodide <script>，有 preconnect ==
  {
    ok(!/script src="https:\/\/[^"]*pyodide\.js/.test(BUILT_INDEX),
       "6 index.html 不再写死 pyodide.js <script>（挂起会卡死后续脚本）");
    for (const host of ["cdn.jsdelivr.net", "fastly.jsdelivr.net", "gcore.jsdelivr.net"]) {
      ok(BUILT_INDEX.includes(`href="https://${host}"`),
         `6 有 ${host} 的 preconnect`);
    }
    // la-bridge.js 仍要带版本号（缓存 bust 依赖它）
    ok(/la-bridge\.js\?v=[a-f0-9]{8}/.test(BUILT_INDEX), "6 la-bridge.js 带 ?v");
  }

  console.log(`bridge-fallback: ${pass.length}/${n} 项通过`);
  if (fails.length) {
    console.log("FAIL");
    for (const f of fails) console.log("  -", f);
    process.exit(1);
  }
  console.log("OK：换源/超时/全部失败/构建产物全部符合预期");
})().catch((e) => {
  console.error("测试执行异常：", e);
  process.exit(1);
});

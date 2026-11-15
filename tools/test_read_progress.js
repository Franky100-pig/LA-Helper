#!/usr/bin/env node
/* 「滑到底才打勾」回归测试。
 *
 * 判定逻辑在 progress.js 的 LA_PROGRESS.atBottom(scrollY, innerHeight, scrollHeight)，
 * 这里用 vm 把它真跑起来测边界值（不是 grep 源码断言）:
 *   1) 顶部不算读完、底部算读完
 *   2) 60px 容差：差 61px 不算、差 59px 算（字体/图片加载误差不误伤）
 *   3) 短讲义（内容不足一屏）一打开就算读完
 * 再静态兜住接线：notes-page.js 必须调 atBottom 且不能再「打开即 markRead」。
 *
 * 用法：node tools/test_read_progress.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
let failures = 0;
const ok = (cond, m) => {
  if (cond) console.log("  ✓ " + m);
  else { console.error("  ✗ " + m); failures++; }
};

// ---- 用 vm 加载 progress.js，拿到纯判定函数 ---------------------------------
const sandbox = {
  window: { dispatchEvent() {} },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  CustomEvent: function () {},
  console,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, "web", "progress.js"), "utf8"), sandbox,
  { filename: "progress.js" });
const atBottom = sandbox.window.LA_PROGRESS && sandbox.window.LA_PROGRESS.atBottom;
ok(typeof atBottom === "function", "progress.js 暴露 atBottom 判定函数");

console.log("\n[1] 顶部 / 底部");
if (typeof atBottom === "function") {
  ok(atBottom(0, 800, 4000) === false, "顶部（scrollY=0，长文）不算读完");
  ok(atBottom(3200, 800, 4000) === true, "正好滑到底算读完");
  ok(atBottom(4000, 800, 4000) === true, "滚过头也算读完");
}

console.log("\n[2] 60px 容差边界");
if (typeof atBottom === "function") {
  // scrollHeight 4000，视口 800 → 底部 scrollY=3200
  ok(atBottom(3139, 800, 4000) === false, "离底 61px 不算读完");
  ok(atBottom(3140, 800, 4000) === true, "离底 60px 算读完（含边界）");
  ok(atBottom(3141, 800, 4000) === true, "离底 59px 算读完");
}

console.log("\n[3] 短讲义：内容不足一屏");
if (typeof atBottom === "function") {
  ok(atBottom(0, 800, 500) === true, "内容 500 < 视口 800，一打开算读完");
  ok(atBottom(0, 800, 850) === false, "内容 850 略高于视口，顶部不算读完");
}

console.log("\n[4] 接线：notes-page.js 真的用了滑到底判定");
const page = fs.readFileSync(path.join(ROOT, "web", "notes-page.js"), "utf8");
ok(/LA_PROGRESS\.atBottom\s*\(/.test(page), "atPageBottom 调用了 LA_PROGRESS.atBottom");
ok(/addEventListener\(\s*["']scroll["']/.test(page), "装了 scroll 监听");
ok(/removeEventListener\(\s*["']scroll["']/.test(page), "换页时解绑 scroll 监听");
// 旧的「renderArticle 一进来就 markRead」模式必须消失：markRead 只在 finish() 里出现
const markCalls = (page.match(/LA_PROGRESS\.markRead\s*\(/g) || []).length;
ok(markCalls === 1, `markRead 只在读完回调里调用一次（实际 ${markCalls} 处）`);
ok(/function clearReadWatch/.test(page) && /clearReadWatch\(\)/.test(page),
  "有解绑函数且被调用（防重复标记 / 误标记）");

console.log(`\n${failures ? `失败：${failures} 处问题。` : "全部通过 ✓"}`);
process.exit(failures ? 1 : 0);

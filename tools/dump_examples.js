// 把 examples.js 里的数据导出成 JSON，供 tools/test_examples.py 喂给真正的 Python 引擎。
// 用法：node tools/dump_examples.js
//
// 为什么要绕这一下：examples.js 是给浏览器跑的经典脚本（挂 window），不是模块。
// 与其在 Python 里用正则去剖 JS（脆得很），不如让 Node 自己求值后打印。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EX = path.join(__dirname, "..", "web", "examples.js");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(EX, "utf8"), sandbox, { filename: EX });

process.stdout.write(JSON.stringify(sandbox.window.LA_EXAMPLES));

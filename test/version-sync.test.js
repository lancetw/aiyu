#!/usr/bin/env node
// 驗證四個版號落點一致（即 scripts/bump-version.js 會改的那幾處）。
// HOST_VERSION 曾停在 0.3.2 而 package.json 已到 0.4.6，好幾個月沒人發現：
// host 啟動 log 與 ping 回報的版本錯了，popup 的「host 過舊」提示就會誤判。
// 用法：node test/version-sync.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const pkg = JSON.parse(read("host/package.json")).version;

assert.strictEqual(JSON.parse(read("extension/manifest.json")).version, pkg, "manifest.json 版號應等於 host/package.json");
assert.strictEqual(read("host/aiyu-host.js").match(/const HOST_VERSION = "([\d.]+)"/)?.[1], pkg, "HOST_VERSION 應等於 host/package.json");
assert.strictEqual(read("README.md").match(/> \*\*狀態\*\*：([\d.]+)/)?.[1], pkg, "README 狀態行應等於 host/package.json");

console.log(`✓ version-sync: 四處版號一致（${pkg}）`);

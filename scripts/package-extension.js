#!/usr/bin/env node
// 打包 extension/ 成 Chrome Web Store 上架用的 zip。
//
//   用法：node scripts/package-extension.js [x.y.z]
//   省略版本 → 取 extension/manifest.json 目前版號。打包對應的 v<版本> git tag。
//
// 一律從 git tag 取檔（git archive），不從工作區：
//   - 產物 100% 等於該 release tag，不會混進未追蹤雜物、空目錄（如空的 vendor/）或 .DS_Store。
//   - `<tag>:extension` 這個 tree-ish 讓 extension/ 成為壓縮根 → manifest.json 落在 zip 根層（CWS 硬性要求）。
//   別用 `zip -r .` 取代本腳本：那會把工作區雜物掃進送審包。
//
// 兩道 fail-loud 防線：tag 必須存在；tag 內 manifest 版號必須等於預期版號（擋 tag 指錯 commit）。
//
// 輸出：<repo 外層>/aiyu-extension-<版本>.zip（放 repo 外，不污染 git status）。

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 版本：用參數，否則讀 manifest 現值
const version =
  process.argv[2] ||
  JSON.parse(readFileSync(join(ROOT, "extension/manifest.json"), "utf8")).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本格式不對：${version}（預期 x.y.z）`);
  process.exit(1);
}
const tag = `v${version}`;

// 防線 1：tag 必須存在
try {
  execFileSync("git", ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], {
    cwd: ROOT,
    stdio: "ignore"
  });
} catch {
  console.error(`找不到 tag ${tag}。請先完成 release commit + 打 tag（或傳入正確版本）。`);
  process.exit(1);
}

// 防線 2：tag 內 manifest 版號要等於預期（擋 tag 指錯 commit）
const taggedVersion = JSON.parse(
  execFileSync("git", ["show", `${tag}:extension/manifest.json`], { cwd: ROOT, encoding: "utf8" })
).version;
if (taggedVersion !== version) {
  console.error(`⚠️  tag ${tag} 的 manifest 版號是 ${taggedVersion}，與預期 ${version} 不符 —— tag 可能指錯 commit。`);
  process.exit(1);
}

const out = join(ROOT, "..", `aiyu-extension-${version}.zip`);
execFileSync("git", ["archive", "--format=zip", `--output=${out}`, `${tag}:extension`], {
  cwd: ROOT,
  stdio: "inherit"
});
console.log(`✅ 已打包 ${tag} → ${out}（manifest 在 zip 根層，可直接上傳 CWS）`);

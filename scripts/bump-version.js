#!/usr/bin/env node
// 一鍵同步 aiyu 版本號到三通道的所有落點，避免漏改造成 git / npm / CWS 版號不一致。
//
//   用法：node scripts/bump-version.js <x.y.z>     例如：node scripts/bump-version.js 0.4.3
//
// 落點（5 處）：
//   1) extension/manifest.json   頂層 "version"          → CWS 上架版號
//   2) host/package.json         "version"               → npm @lancetw/aiyu 版號
//   3) host/package-lock.json    自身版號（root + packages[""]，共 2 處）
//   4) README.md                 「> **狀態**：x.y.z」狀態行
//
// host/ 的 package.json + lock 交給 `npm version` 處理：npm 只動套件自身版號、
// 絕不誤改相依（lock 內每個相依也有 "version"，盲目字串替換會中招）。
// manifest 與 README 用錨定 regex 精準替換，保留原檔格式（不 JSON.stringify 整檔，避免重排）。

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NEW = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(NEW || "")) {
  console.error("用法：node scripts/bump-version.js <x.y.z>，例如：node scripts/bump-version.js 0.4.3");
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 1) host：package.json + package-lock.json 的自身版號（npm 保證只動自己、不碰相依）
execFileSync("npm", ["version", NEW, "--no-git-tag-version", "--allow-same-version"], {
  cwd: join(ROOT, "host"),
  stdio: "inherit"
});

// 2) extension manifest：只換頂層 "version"（manifest_version 是別的 key，"version" 不會誤命中）
patch(join(ROOT, "extension/manifest.json"), /("version":\s*")\d+\.\d+\.\d+(")/, `$1${NEW}$2`);

// 3) README 狀態行
patch(join(ROOT, "README.md"), /(> \*\*狀態\*\*：)\d+\.\d+\.\d+/, `$1${NEW}`);

console.log(`✅ 版本號已同步 → ${NEW}（manifest / host package+lock / README）`);

function patch(file, re, replacement) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(re, replacement);
  if (after === before) {
    console.error(`⚠️  ${file} 未命中版本字串，格式可能變了，請手動檢查（其他檔可能已改，記得 git checkout 還原）`);
    process.exit(1);
  }
  writeFileSync(file, after);
}

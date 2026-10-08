#!/usr/bin/env node
// 一鍵同步 aiyu 版本號到三通道的所有落點，避免漏改造成 git / npm / CWS 版號不一致。
//
//   用法：node scripts/bump-version.js <x.y.z>     例如：node scripts/bump-version.js 0.4.3
//
// 落點（6 處）：
//   1) extension/manifest.json   頂層 "version"          → CWS 上架版號
//   2) host/package.json         "version"               → npm @lancetw/aiyu 版號
//   3) host/package-lock.json    自身版號（root + packages[""]，共 2 處）
//   4) README.md                 「> **狀態**：x.y.z」狀態行
//   5) host/aiyu-host.js         HOST_VERSION（host 啟動 log 的版號，供除錯時辨識使用者裝的是哪版 host）
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

// 4) host 啟動 log 版號
patch(join(ROOT, "host/aiyu-host.js"), /(const HOST_VERSION = ")\d+\.\d+\.\d+(")/, `$1${NEW}$2`);

console.log(`✅ 版本號已同步 → ${NEW}（manifest / host package+lock / README / HOST_VERSION）`);

// 發版其餘步驟（順序有相依：package-extension 從 tag 取檔；GitHub Release 說明寫 npm 已同步，故等 npm 上架後才建）
console.log(`
接下來：
  1. npm test
  2. git add README.md extension/manifest.json host/aiyu-host.js host/package.json host/package-lock.json
     git commit -m "chore(release): ${NEW} — <摘要>"
  3. git tag -a v${NEW} -m "aiyu ${NEW}"
  4. node scripts/package-extension.js          → ../aiyu-extension-${NEW}.zip（CWS 送審包）
  5. (cd host && npm pack --dry-run)            → 確認沒夾帶 agy-workspace 等執行期雜物
  6. git push origin master v${NEW}
  7. (cd host && npm publish --access public)   → 需要 OTP，於互動終端機執行
  8. 等 npm 上架：curl -s https://registry.npmjs.org/@lancetw/aiyu/${NEW} 回 JSON、tarball 回 200
     （別用 npm view：本機若有 pmg 等 cooldown 包裝，新版會被藏起來）
  9. gh release create v${NEW} --verify-tag --title "v${NEW} — <標題>" --notes-file <說明>
 10. 上傳 zip 到 Chrome Web Store（手動）`);

function patch(file, re, replacement) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(re, replacement);
  if (after === before) {
    console.error(`⚠️  ${file} 未命中版本字串，格式可能變了，請手動檢查（其他檔可能已改，記得 git checkout 還原）`);
    process.exit(1);
  }
  writeFileSync(file, after);
}

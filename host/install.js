#!/usr/bin/env node
// aiyu 跨平台 native host 安裝器 —— 取代 install.sh / deploy.sh，並新增 Windows 支援。
//
// 做的事：
//   1. 把 host（aiyu-host.js）複製到穩定目錄（mac/win 的 app data；linux 的 ~/.local/share）。
//      —— host 必須住在 repo 外：macOS TCC 會擋 Chrome 存取 ~/Documents 下的 script。
//   2. 產生 launcher（unix .sh / win .cmd），用「當下這顆 node 的絕對路徑」啟動 host。
//      —— 不依賴 shebang，順手解決 aiyu-host.js 寫死 nvm 路徑、以及 Windows 無 shebang 的問題。
//   3. 註冊 native messaging manifest：
//        mac/linux → 寫進每個偵測到的瀏覽器 NativeMessagingHosts 目錄
//        windows   → 寫一份 manifest 到安裝目錄，再用 reg.exe 把各瀏覽器登錄檔機碼指過去
//   4. 印出「載入未封裝」的擴充資料夾路徑與步驟（off-store 安裝）。
//
// 用法：
//   node install.js              安裝 host 並印出擴充安裝步驟
//   node install.js --dry-run    只印出會做什麼，不實際寫入
//   node install.js --uninstall  移除 host 註冊（manifest / 登錄檔）
//
// 擴充 ID 是從 extension/manifest.json 的 key 推導出來的固定值（off-store 自有金鑰，永遠一致）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOST_NAME = "com.lancetw.aiyu";
// 擴充 ID。host 的 allowed_origins 同時信任兩者（dual-ID）：
//   DEV   = off-store 載入未封裝（ID 由 manifest 的 key 推導，固定）
//   STORE = Chrome Web Store 上架後指派的 ID
// 兩個 build 用不同 ID，但同一台 host 都收 → dev 與 store 安裝都能連線。
// DEV 重新計算： node -e 'const c=require("crypto"),f=require("fs");const k=JSON.parse(f.readFileSync("extension/manifest.json")).key;console.log([...c.createHash("sha256").update(Buffer.from(k,"base64")).digest("hex").slice(0,32)].map(x=>String.fromCharCode(97+parseInt(x,16))).join(""))'
const DEV_EXT_ID = "loelfpeedlfjbjekifhjbbgejajnnpan";
const STORE_EXT_ID = "mkdjepnmcmmjbnhkligompoblagocjmd";
const EXT_IDS = [DEV_EXT_ID, STORE_EXT_ID];

const PLATFORM = process.platform; // 'darwin' | 'linux' | 'win32'
const HOME = os.homedir();
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url)); // host/
const REPO_ROOT = path.join(SRC_DIR, "..");
const EXT_DIR = path.join(REPO_ROOT, "extension");
const HOST_JS_SRC = path.join(SRC_DIR, "aiyu-host.js");

const argv = new Set(process.argv.slice(2));
const DRY = argv.has("--dry-run");
const UNINSTALL = argv.has("--uninstall");
const HELP = argv.has("--help") || argv.has("-h");

function log(...a) { console.log(...a); }
function step(s) { console.log((DRY ? "[dry-run] " : "") + s); }

function installDir() {
  if (PLATFORM === "darwin") return path.join(HOME, "Library/Application Support/aiyu");
  if (PLATFORM === "win32")
    return path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData/Local"), "aiyu");
  return path.join(process.env.XDG_DATA_HOME || path.join(HOME, ".local/share"), "aiyu"); // linux
}

// unix：各瀏覽器 NativeMessagingHosts 目錄（parent 存在才算裝了該瀏覽器）
function unixBrowserDirs() {
  const ASUP = path.join(HOME, "Library/Application Support");
  const CFG = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
  if (PLATFORM === "darwin")
    return [
      "Google/Chrome", "Google/Chrome Canary", "Google/Chrome Beta", "Google/Chrome Dev",
      "Google/Chrome for Testing", "Chromium", "Microsoft Edge",
      "BraveSoftware/Brave-Browser", "Arc/User Data"
    ].map((b) => path.join(ASUP, b, "NativeMessagingHosts"));
  return [
    "google-chrome", "google-chrome-beta", "google-chrome-unstable", "chromium",
    "microsoft-edge", "BraveSoftware/Brave-Browser"
  ].map((b) => path.join(CFG, b, "NativeMessagingHosts"));
}

// windows：各瀏覽器登錄檔機碼（HKCU，免管理員）
function winRegKeys() {
  return [
    "Software\\Google\\Chrome",
    "Software\\Chromium",
    "Software\\Microsoft\\Edge",
    "Software\\BraveSoftware\\Brave-Browser"
  ].map((b) => `HKCU\\${b}\\NativeMessagingHosts\\${HOST_NAME}`);
}

function regExe() {
  return path.join(process.env.SystemRoot || "C:\\Windows", "System32", "reg.exe");
}

function manifestObject(launcherPath) {
  return {
    name: HOST_NAME,
    description: "aiyu — AI 譯語 native host",
    path: launcherPath,
    type: "stdio",
    allowed_origins: EXT_IDS.map((id) => `chrome-extension://${id}/`)
  };
}

function writeFile(p, content, mode) {
  step(`寫入 ${p}`);
  if (DRY) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  if (mode) fs.chmodSync(p, mode);
}

function doInstall() {
  if (!fs.existsSync(HOST_JS_SRC)) {
    console.error(`✗ 找不到 host：${HOST_JS_SRC}（請從 repo 根目錄附近執行）`);
    process.exit(1);
  }

  const dir = installDir();
  // host 被複製到無 package.json 的目錄 → 必須用 .mjs 副檔名才會被當 ESM 跑
  const hostJsDst = path.join(dir, "aiyu-host.mjs");

  // 1. 複製 host
  step(`複製 host → ${hostJsDst}`);
  if (!DRY) {
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(HOST_JS_SRC, hostJsDst);
  }

  // 2. 產生 launcher（用 process.execPath 這顆 node 的絕對路徑啟動，不靠 shebang）
  const node = process.execPath;
  let launcherPath;
  if (PLATFORM === "win32") {
    launcherPath = path.join(dir, "aiyu-host.cmd");
    writeFile(launcherPath, `@echo off\r\n"${node}" "${hostJsDst}" %*\r\n`);
  } else {
    launcherPath = path.join(dir, "aiyu-host-launcher.sh");
    const sh =
`#!/bin/sh
# Chrome 啟動 native host 時 PATH 極簡 —— 補上常見 CLI 安裝位置，再用固定的 node 啟動 host。
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
exec "${node}" "${hostJsDst}" "$@"
`;
    writeFile(launcherPath, sh, 0o755);
  }

  // 3. 註冊 manifest
  const manifest = JSON.stringify(manifestObject(launcherPath), null, 2);
  let registered = 0;
  if (PLATFORM === "win32") {
    const manifestPath = path.join(dir, `${HOST_NAME}.json`);
    writeFile(manifestPath, manifest);
    for (const key of winRegKeys()) {
      step(`reg add ${key} → ${manifestPath}`);
      if (DRY) { registered++; continue; }
      try {
        execFileSync(regExe(), ["add", key, "/ve", "/t", "REG_SZ", "/d", manifestPath, "/f"], {
          stdio: "ignore"
        });
        registered++;
      } catch (e) {
        console.error(`  ⚠ 寫入登錄檔失敗 ${key}: ${e.message}`);
      }
    }
  } else {
    for (const d of unixBrowserDirs()) {
      if (!fs.existsSync(path.dirname(d))) continue; // 沒裝這個瀏覽器
      writeFile(path.join(d, `${HOST_NAME}.json`), manifest);
      registered++;
    }
  }

  if (registered === 0)
    console.error("\n⚠ 沒偵測到任何已安裝的 Chromium 系瀏覽器。host 已就位，但未寫入任何瀏覽器。");

  printExtensionSteps();
  log(`\n✓ host 安裝完成（${registered} 個瀏覽器位置）。`);
}

function printExtensionSteps() {
  if (fs.existsSync(EXT_DIR)) {
    // 從 repo 跑（有同層 extension/）：載入未封裝 dev build
    log("\n──────── 安裝擴充（off-store / 載入未封裝）────────");
    log("1. 開啟  chrome://extensions");
    log("2. 右上角開啟「開發人員模式」（請保持開啟，否則擴充會被停用）");
    log("3. 點「載入未封裝項目」，選這個資料夾：");
    log(`     ${EXT_DIR}`);
    log(`4. 載入後顯示的 Extension ID 應為： ${DEV_EXT_ID}`);
    log("   （若不同，表示 manifest 的 key 被改過 → 重跑安裝器更新 host 的 allowed_origins）");
    log("5. 重啟瀏覽器，點擴充圖示 →「測試 host 連線」。");
  } else {
    // 從 npx 跑（沒有同層 extension/）：擴充來自 Chrome Web Store
    log("\n──────── 安裝擴充（Chrome Web Store）────────");
    log("1. 到 Chrome Web Store 安裝 aiyu：");
    log(`     https://chromewebstore.google.com/detail/${STORE_EXT_ID}`);
    log("2. 重啟瀏覽器，點擴充圖示 →「測試 host 連線」。");
  }
}

function doUninstall() {
  const dir = installDir();
  if (PLATFORM === "win32") {
    for (const key of winRegKeys()) {
      step(`reg delete ${key}`);
      if (!DRY) {
        try { execFileSync(regExe(), ["delete", key, "/f"], { stdio: "ignore" }); } catch { /* 沒這個機碼 */ }
      }
    }
  } else {
    for (const d of unixBrowserDirs()) {
      const out = path.join(d, `${HOST_NAME}.json`);
      if (fs.existsSync(out)) { step(`刪除 ${out}`); if (!DRY) fs.rmSync(out); }
    }
  }
  step(`刪除安裝目錄 ${dir}`);
  if (!DRY && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  log("\n✓ 已移除 host 註冊。擴充請到 chrome://extensions 自行移除。");
}

function printHelp() {
  log(`aiyu 跨平台 native host 安裝器

用法：
  node install.js              安裝 host 並印出擴充安裝步驟
  node install.js --dry-run    只印出會做什麼，不實際寫入
  node install.js --uninstall  移除 host 註冊（manifest / 登錄檔）

平台：${PLATFORM}　擴充 ID（dev／store）：${DEV_EXT_ID} ／ ${STORE_EXT_ID}`);
}

(function main() {
  if (HELP) return printHelp();
  log(`aiyu installer　平台=${PLATFORM}　node=${process.version}${DRY ? "　(dry-run)" : ""}`);
  if (UNINSTALL) return doUninstall();
  doInstall();
})();

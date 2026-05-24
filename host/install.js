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
import { fileURLToPath, pathToFileURL } from "node:url";

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

const argList = process.argv.slice(2);
const argv = new Set(argList);
const DRY = argv.has("--dry-run");
const UNINSTALL = argv.has("--uninstall");
const HELP = argv.has("--help") || argv.has("-h");
const ALL = argv.has("--all");
const BROWSERS_FLAG = (() => {
  const p = argList.find((a) => a.startsWith("--browsers="));
  return p ? p.slice("--browsers=".length) : null;
})();

function log(...a) { console.log(...a); }
function step(s) { console.log((DRY ? "[dry-run] " : "") + s); }

function installDir() {
  if (PLATFORM === "darwin") return path.join(HOME, "Library/Application Support/aiyu");
  if (PLATFORM === "win32")
    return path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData/Local"), "aiyu");
  return path.join(process.env.XDG_DATA_HOME || path.join(HOME, ".local/share"), "aiyu"); // linux
}

// 單一真相來源：每個瀏覽器一筆。id = 使用者在 --browsers 用的短名；label 給選單顯示。
// mac/linux 為 NativeMessagingHosts 之上層子路徑；win 為 HKCU 機碼基底（null = 該平台無此瀏覽器）。
const BROWSERS = [
  { id: "chrome",   label: "Google Chrome",             mac: "Google/Chrome",                 linux: "google-chrome",          win: "Software\\Google\\Chrome" },
  { id: "canary",   label: "Google Chrome Canary",      mac: "Google/Chrome Canary",          linux: null,                     win: null },
  { id: "beta",     label: "Google Chrome Beta",        mac: "Google/Chrome Beta",            linux: "google-chrome-beta",     win: null },
  { id: "dev",      label: "Google Chrome Dev",         mac: "Google/Chrome Dev",             linux: "google-chrome-unstable", win: null },
  { id: "testing",  label: "Google Chrome for Testing", mac: "Google/Chrome for Testing",     linux: null,                     win: null },
  { id: "chromium", label: "Chromium",                  mac: "Chromium",                      linux: "chromium",               win: "Software\\Chromium" },
  { id: "edge",     label: "Microsoft Edge",            mac: "Microsoft Edge",                linux: "microsoft-edge",         win: "Software\\Microsoft\\Edge" },
  { id: "brave",    label: "Brave",                     mac: "BraveSoftware/Brave-Browser",   linux: "BraveSoftware/Brave-Browser", win: "Software\\BraveSoftware\\Brave-Browser" },
  { id: "arc",      label: "Arc",                       mac: "Arc/User Data",                 linux: null,                     win: null },
];

// 該瀏覽器在本平台的 NativeMessagingHosts 目錄（不支援則回 null）
function nmhDir(b) {
  const ASUP = path.join(HOME, "Library/Application Support");
  const CFG = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
  if (PLATFORM === "darwin") return b.mac ? path.join(ASUP, b.mac, "NativeMessagingHosts") : null;
  return b.linux ? path.join(CFG, b.linux, "NativeMessagingHosts") : null; // linux
}

// 偵測：unix 上「NativeMessagingHosts 父目錄存在」視為已裝；win best-effort（無法可靠偵測）回傳所有有機碼者
function detectedBrowsers() {
  if (PLATFORM === "win32") return BROWSERS.filter((b) => b.win);
  return BROWSERS.filter((b) => {
    const d = nmhDir(b);
    return d && fs.existsSync(path.dirname(d));
  });
}

function winRegKey(b) {
  return `HKCU\\${b.win}\\NativeMessagingHosts\\${HOST_NAME}`;
}

function parseBrowsersFlag(str) {
  const ids = [...new Set(String(str).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const valid = new Set(BROWSERS.map((b) => b.id));
  return { known: ids.filter((id) => valid.has(id)), unknown: ids.filter((id) => !valid.has(id)) };
}

// 決定要裝到哪些。回傳 { mode:"list", ids } 或 { mode:"interactive" }
function resolveSelection({ browsersFlag, all, isTTY, detectedIds }) {
  if (browsersFlag) return { mode: "list", ids: parseBrowsersFlag(browsersFlag).known };
  if (all) return { mode: "list", ids: detectedIds };
  if (isTTY) return { mode: "interactive" };
  return { mode: "list", ids: detectedIds }; // 非 TTY 退路：全裝（保護 auto-deploy）
}

// TTY 互動多選；只在此分支才動態載入 clack。未安裝則 fail-soft 退回全裝。
async function pickInteractive(detected) {
  let clack;
  try {
    clack = await import("@clack/prompts");
  } catch {
    console.error("⚠ 互動選單需要 @clack/prompts；未安裝，退回全裝。（在 host/ 跑 npm i 後即可使用選單）");
    return detected.map((b) => b.id);
  }
  const picked = await clack.multiselect({
    message: "要安裝 aiyu host 到哪些瀏覽器？（空白鍵勾選，Enter 確認）",
    options: detected.map((b) => ({ value: b.id, label: b.label })),
    initialValues: detected.map((b) => b.id), // 全選 → Enter = 全裝（向後相容）
  });
  if (clack.isCancel(picked)) {
    clack.cancel("已取消，未變更任何瀏覽器。");
    process.exit(0);
  }
  return picked;
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

async function doInstall() {
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
  const detected = detectedBrowsers();
  if (BROWSERS_FLAG) {
    const { unknown } = parseBrowsersFlag(BROWSERS_FLAG);
    if (unknown.length)
      console.error(`⚠ 略過未知瀏覽器 id：${unknown.join(", ")}（合法：${BROWSERS.map((b) => b.id).join(", ")}）`);
  }
  const sel = resolveSelection({
    browsersFlag: BROWSERS_FLAG,
    all: ALL,
    isTTY: process.stdout.isTTY,
    detectedIds: detected.map((b) => b.id),
  });
  const chosenIds = sel.mode === "interactive" ? await pickInteractive(detected) : sel.ids;
  const detectedIdSet = new Set(detected.map((b) => b.id));
  const targets = BROWSERS.filter((b) => chosenIds.includes(b.id) && detectedIdSet.has(b.id));
  if (BROWSERS_FLAG && targets.length === 0) {
    console.error(`✗ --browsers 指定的瀏覽器都沒偵測到。偵測到的：${[...detectedIdSet].join(", ") || "（無）"}`);
    process.exit(1);
  }
  let registered = 0;
  if (PLATFORM === "win32") {
    const manifestPath = path.join(dir, `${HOST_NAME}.json`);
    writeFile(manifestPath, manifest);
    for (const b of targets) {
      const key = winRegKey(b);
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
    for (const b of targets) {
      writeFile(path.join(nmhDir(b), `${HOST_NAME}.json`), manifest);
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
  const onlyIds = BROWSERS_FLAG ? parseBrowsersFlag(BROWSERS_FLAG).known : null;
  const inScope = (b) => !onlyIds || onlyIds.includes(b.id);
  if (PLATFORM === "win32") {
    for (const b of BROWSERS) {
      if (!inScope(b)) continue;
      if (!b.win) continue;
      const key = winRegKey(b);
      step(`reg delete ${key}`);
      if (!DRY) {
        try { execFileSync(regExe(), ["delete", key, "/f"], { stdio: "ignore" }); } catch { /* 沒這個機碼 */ }
      }
    }
  } else {
    for (const b of BROWSERS) {
      if (!inScope(b)) continue;
      const d = nmhDir(b);
      if (!d) continue;
      const out = path.join(d, `${HOST_NAME}.json`);
      if (fs.existsSync(out)) { step(`刪除 ${out}`); if (!DRY) fs.rmSync(out); }
    }
  }
  if (!onlyIds) {
    step(`刪除安裝目錄 ${dir}`);
    if (!DRY && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  log("\n✓ 已移除 host 註冊。擴充請到 chrome://extensions 自行移除。");
}

function printHelp() {
  log(`aiyu 跨平台 native host 安裝器

用法：
  node install.js                          安裝 host（TTY 下互動選擇瀏覽器）
  node install.js --all                    安裝到所有偵測到的瀏覽器（跳過提問）
  node install.js --browsers=chrome,brave  只安裝到指定瀏覽器
  node install.js --dry-run                只印出會做什麼，不實際寫入
  node install.js --uninstall              移除 host 註冊（可加 --browsers= 只移除部分）

瀏覽器 id：${BROWSERS.map((b) => b.id).join(", ")}
平台：${PLATFORM}　擴充 ID（dev／store）：${DEV_EXT_ID} ／ ${STORE_EXT_ID}`);
}

async function main() {
  if (HELP) return printHelp();
  log(`aiyu installer　平台=${PLATFORM}　node=${process.version}${DRY ? "　(dry-run)" : ""}`);
  if (UNINSTALL) return doUninstall();
  return doInstall();
}

export { parseBrowsersFlag, resolveSelection };

// 直接執行才跑 main；被 import（測試）時不跑
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

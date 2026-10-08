#!/usr/bin/env node
// 驗證 get-settings 訊息回傳「目前設定會套用的模型」標籤 —— YouTube「重新翻譯」按鈕文案的契約。
// 用法：node test/sw-get-settings.test.js

const assert = require("assert");

let onMsg = null;        // 捕捉 sw.js 註冊的 onMessage listener
let storedSettings = {}; // 由各測試案例設定

global.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener: (fn) => { onMsg = fn; } },
    getPlatformInfo: (cb) => cb && cb({}),
    get lastError() { return undefined; }
  },
  contextMenus: { onClicked: { addListener() {} }, removeAll: (cb) => cb && cb(), create: () => {} },
  // getSettings 以 get(defaults) 取值；真實 API 會把已存值覆蓋預設 → 用 storedSettings 模擬
  storage: { sync: { get: async (defaults) => ({ ...defaults, ...storedSettings }), set: async () => {} } }
};

require("../extension/sw.js");
assert.ok(typeof onMsg === "function", "sw.js 應註冊 onMessage listener");

function getSettings(over) {
  storedSettings = over;
  return new Promise((resolve) => onMsg({ type: "get-settings" }, {}, resolve));
}

(async () => {
  let r = await getSettings({ cli: "codex", codexModel: "gpt-5.4-mini" });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.model, "Codex · gpt-5.4-mini", "codex 應回報後端＋模型");

  r = await getSettings({ cli: "claude", claudeModel: "haiku" });
  assert.strictEqual(r.model, "Claude · Haiku 最新", "claude 別名應回報後端＋「家族 最新」");

  // agy 1.3 起 print 模式可選模型：預設自動（帳號端路由）、可鎖定清單內模型
  r = await getSettings({ cli: "agy", agyModel: "gemini-3.8-flash" });
  assert.strictEqual(r.model, "Antigravity · gemini-3.8-flash", "agy 應回報所選模型");
  // 0.5.x 存的舊 slug（含強度後綴）→ 拆回基本型號，不退回自動
  r = await getSettings({ cli: "agy", agyModel: "gemini-3.8-flash-low" });
  assert.strictEqual(r.model, "Antigravity · gemini-3.8-flash", "agy 舊 slug 應拆回基本型號");
  // agy 下架模型會 exit 1 → 與 codex 同樣過白名單，清單外的舊值退回預設（自動）
  r = await getSettings({ cli: "agy", agyModel: "gemini-0-retired" });
  assert.strictEqual(r.model, "Antigravity · 自動", "agy 清單外模型應退回自動");
  r = await getSettings({ cli: "agy" });
  assert.strictEqual(r.model, "Antigravity · 自動", "agy 預設自動");

  // 標籤需與「實際翻譯回報」一致，故 settings 也一併帶回供其他用途
  assert.strictEqual(r.settings.cli, "agy", "應一併回傳 settings");

  console.log("✓ sw-get-settings: 回報目前設定會套用的模型標籤");
  process.exit(0);
})().catch((e) => {
  console.error("✗ 測試失敗：", e.message);
  process.exit(1);
});

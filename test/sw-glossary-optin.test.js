#!/usr/bin/env node
// 驗證台灣詞庫是 opt-in：預設「不啟用」，內建詞庫不得進入翻譯 prompt；
// 唯有使用者在進階設定勾選「啟用台灣詞庫」（glossaryEnabled=true）後，詞庫才送達 host。
// 為何重要：詞庫注入是 prompt-level steering，誤啟用會替使用者改變譯詞偏好；
// 故「送不送」必須由使用者明確決定，而非預設替他開。
// 攔截送往 host 的 message 看實際 glossary，比檢查 storage 值更貼近真正進不進 prompt。
// 用法：node test/sw-glossary-optin.test.js

const assert = require("assert");
const AIYU = require("../extension/shared/models.js");

let onMsg = null;     // 捕捉 get-settings listener
let lastSent = null;  // 最近一次送往 host 的 message
let stored = {};      // storage.sync 內容（{} = 全新安裝）

function makeFakePort() {
  let portMsg = null;
  return {
    onMessage: { addListener: (cb) => { portMsg = cb; } },
    onDisconnect: { addListener: () => {} },
    postMessage: (m) => {
      lastSent = m;
      const result = (m.segments || []).map((s) => ({ id: s.id, zh: "ZH:" + s.text }));
      setTimeout(() => portMsg && portMsg({ id: m.id, result, meta: { usedCli: m.cli, fellBack: false } }), 0);
    }
  };
}
const fakePort = makeFakePort();

global.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener: (fn) => { onMsg = fn; } },
    connectNative: () => fakePort,
    getPlatformInfo: (cb) => cb && cb({}),
    get lastError() { return undefined; }
  },
  contextMenus: { onClicked: { addListener() {} }, removeAll: (cb) => cb && cb(), create: () => {} },
  storage: { sync: { get: async (defaults) => ({ ...defaults, ...stored }), set: async () => {} } },
  tabs: { sendMessage: async () => {} },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} }
};

const { translateBatch } = require("../extension/sw.js");

function getSettings(over) {
  stored = over;
  return new Promise((resolve) => onMsg({ type: "get-settings" }, {}, resolve));
}

// 內建詞庫內容永遠帶在 settings.glossary；glossaryEnabled 才是 gate（兩者正交）
const base = {
  cli: "codex", codexModel: "gpt-5.4-mini", claudeModel: "haiku",
  target: "zh-TW", style: "natural", customPrompt: "", glossary: AIYU.DEFAULT_GLOSSARY
};

(async () => {
  // 1) 全新安裝（storage 無 glossaryEnabled）→ getSettings 預設不啟用
  const s = await getSettings({});
  assert.strictEqual(s.settings.glossaryEnabled, false, "全新安裝 glossaryEnabled 預設應為 false");

  // 2) 未啟用 → 送往 host 的 glossary 必為空，內建詞庫不得進 prompt
  await translateBatch([{ id: "a", text: "alpha" }], { ...base, glossaryEnabled: false }, "youtube");
  assert.ok(Array.isArray(lastSent.glossary) && lastSent.glossary.length === 0,
    "未啟用時送往 host 的 glossary 應為空陣列");

  // 3) glossaryEnabled 未定義（fresh）同樣視為不啟用
  await translateBatch([{ id: "b", text: "beta" }], { ...base, glossaryEnabled: undefined }, "youtube");
  assert.strictEqual(lastSent.glossary.length, 0, "glossaryEnabled 未定義應等同不啟用");

  // 4) 啟用 → 送往 host 的 glossary 即內建單一來源詞庫（同一陣列參考、205 條）
  await translateBatch([{ id: "c", text: "gamma" }], { ...base, glossaryEnabled: true }, "youtube");
  assert.strictEqual(lastSent.glossary, AIYU.DEFAULT_GLOSSARY,
    "啟用時應送出 shared/models.js 的單一來源詞庫（同一參考）");
  assert.ok(lastSent.glossary.length >= 200, "啟用時詞庫應為完整內建清單");

  console.log("✓ sw-glossary-optin: 預設不啟用，勾選後內建詞庫才送達 host");
  process.exit(0);
})().catch((e) => {
  console.error("✗ 測試失敗：", e.message);
  process.exit(1);
});

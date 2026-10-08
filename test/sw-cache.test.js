#!/usr/bin/env node
// 驗證 SW 翻譯快取行為（無框架，比照 host/smoke-*.js 的可跑 node 腳本慣例）。
// 用法：node test/sw-cache.test.js
//
// 重點行為：切換模型後，同一段文字應重新翻譯（cache miss），不可命中舊模型快取。
// 用假的 native port 計算 host 被呼叫幾次 → 對 translateBatch 的回傳結構重構免疫。

const assert = require("assert");

// ---- 假的 native port：每次 postMessage 算一次 host 呼叫，非同步回譯文 ----
const state = { hostCalls: 0, fellBack: false, usedCli: null };
function makeFakePort() {
  let onMsg = null;
  return {
    onMessage: { addListener: (cb) => { onMsg = cb; } },
    onDisconnect: { addListener: () => {} },
    postMessage: (m) => {
      state.hostCalls++;
      const result = (m.segments || []).map((s) => ({ id: s.id, zh: "ZH:" + s.text }));
      const meta = { usedCli: state.usedCli || m.cli, fellBack: state.fellBack };
      setTimeout(() => onMsg && onMsg({ id: m.id, result, meta }), 0);
    }
  };
}
const fakePort = makeFakePort();

// ---- 最小 chrome stub（只供 sw.js 載入與 translateBatch 執行所需）----
global.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} },
    connectNative: () => fakePort,
    getPlatformInfo: (cb) => cb && cb({}),
    get lastError() { return undefined; }
  },
  contextMenus: {
    onClicked: { addListener() {} },
    removeAll: (cb) => cb && cb(),
    create: () => {}
  },
  storage: { sync: { get: async () => ({}), set: async () => {} } },
  tabs: { sendMessage: async () => {} },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} }
};

const { translateBatch } = require("../extension/sw.js");

// translateBatch 目前回傳陣列；未來可能回傳 {results,...}。測試只看 hostCalls 與譯文，兩種皆容。
function zhOf(ret, i) {
  const arr = Array.isArray(ret) ? ret : ret.results;
  return arr[i] && arr[i].zh;
}

const baseA = { cli: "codex", codexModel: "gpt-5.4-mini", claudeModel: "haiku", target: "zh-TW", style: "natural", customPrompt: "", glossary: [] };
const seg = [{ id: "s1", text: "hello world" }];

(async () => {
  // 1) 模型 A 首次翻譯 → host 被呼叫一次
  let r = await translateBatch(seg, baseA, "youtube");
  assert.strictEqual(state.hostCalls, 1, "首次翻譯應呼叫 host 一次");
  assert.strictEqual(zhOf(r, 0), "ZH:hello world", "應回傳譯文");

  // 2) 模型 A 再翻同段 → 命中快取，host 不再被呼叫
  r = await translateBatch(seg, baseA, "youtube");
  assert.strictEqual(state.hostCalls, 1, "同模型同段應命中快取，不再呼叫 host");

  // 3) 切換模型 B → 同段應重新翻譯（cache miss），host 再被呼叫一次
  const baseB = { ...baseA, codexModel: "gpt-5.4" };
  r = await translateBatch(seg, baseB, "youtube");
  assert.strictEqual(state.hostCalls, 2, "切換模型後同段應重新翻譯（cache miss）");

  // 4) 切回模型 A → 仍命中 A 的既有快取（不必重翻）
  r = await translateBatch(seg, baseA, "youtube");
  assert.strictEqual(state.hostCalls, 2, "切回舊模型應命中其既有快取，不重複呼叫 host");

  console.log("✓ sw-cache: 切換模型會重新翻譯，切回則命中既有快取");
  process.exit(0);
})().catch((e) => {
  console.error("✗ 測試失敗：", e.message);
  process.exit(1);
});

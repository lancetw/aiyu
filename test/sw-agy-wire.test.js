#!/usr/bin/env node
// 驗證 agy 指定型號時送給 host 的是完整 slug、不帶 effort —— 0.5.x host 不認得 effort，
// 只送基本型號會讓 agy 因缺 --effort 而 exit 1。
// 用法：node test/sw-agy-wire.test.js

const assert = require("assert");

const sent = [];
let onMsg = null;
const fakePort = {
  onMessage: { addListener: (cb) => { onMsg = cb; } },
  onDisconnect: { addListener: () => {} },
  postMessage: (m) => {
    sent.push(m);
    const result = (m.segments || []).map((s) => ({ id: s.id, zh: "ZH:" + s.text }));
    setTimeout(() => onMsg && onMsg({ id: m.id, result, meta: {} }), 0);
  }
};

global.chrome = {
  runtime: {
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener() {} },
    connectNative: () => fakePort,
    getPlatformInfo: (cb) => cb && cb({}),
    get lastError() { return undefined; }
  },
  contextMenus: { onClicked: { addListener() {} }, removeAll: (cb) => cb && cb(), create: () => {} },
  storage: { sync: { get: async () => ({}), set: async () => {} } },
  tabs: { sendMessage: async () => {} },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} }
};

const { translateBatch } = require("../extension/sw.js");
const base = { target: "zh-TW", style: "natural", customPrompt: "", glossary: [] };
let n = 0;
const seg = () => [{ id: "a", text: "hello " + n++ }];

(async () => {
  await translateBatch(seg(), { ...base, cli: "agy", agyModel: "gemini-3.1-pro", agyEffort: "high" }, "youtube");
  assert.strictEqual(sent.at(-1).model, "gemini-3.1-pro-high");
  assert.strictEqual(sent.at(-1).effort, null);
  // 存的 "" → 型號第一個可用強度，slug 仍完整
  await translateBatch(seg(), { ...base, cli: "agy", agyModel: "gemini-3.8-flash", agyEffort: "" }, "youtube");
  assert.strictEqual(sent.at(-1).model, "gemini-3.8-flash-low");
  // 自動型號：不帶 --model，強度走 effort（舊 host 忽略 = 只是少功能）
  await translateBatch(seg(), { ...base, cli: "agy", agyModel: "", agyEffort: "high" }, "youtube");
  assert.strictEqual(sent.at(-1).model, "");
  assert.strictEqual(sent.at(-1).effort, "high");
  // 其他後端照常分開送
  await translateBatch(seg(), { ...base, cli: "claude", claudeModel: "haiku", claudeEffort: "max" }, "youtube");
  assert.strictEqual(sent.at(-1).model, "haiku");
  assert.strictEqual(sent.at(-1).effort, "max");
  console.log("sw-agy-wire ok");
  process.exit(0);
})().catch((e) => { console.error("✗", e.message); process.exit(1); });

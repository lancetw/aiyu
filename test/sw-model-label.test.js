#!/usr/bin/env node
// 驗證 translateBatch 會回報「實際使用的模型」標籤，供中英對照視窗／右鍵翻譯視窗顯示。
// 用法：node test/sw-model-label.test.js

const assert = require("assert");

const state = { fellBack: false, usedCli: null, model: undefined };
function makeFakePort() {
  let onMsg = null;
  return {
    onMessage: { addListener: (cb) => { onMsg = cb; } },
    onDisconnect: { addListener: () => {} },
    postMessage: (m) => {
      const result = (m.segments || []).map((s) => ({ id: s.id, zh: "ZH:" + s.text }));
      const meta = { usedCli: state.usedCli || m.cli, fellBack: state.fellBack, model: state.model };
      setTimeout(() => onMsg && onMsg({ id: m.id, result, meta }), 0);
    }
  };
}
const fakePort = makeFakePort();

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

const base = { codexModel: "gpt-5.4-mini", claudeModel: "haiku", target: "zh-TW", style: "natural", customPrompt: "", glossary: [] };
let n = 0;
const fresh = () => [{ id: "x" + ++n, text: "unique " + n }]; // 每次唯一 → 必為 cache miss

(async () => {
  // codex：標籤含模型名
  let r = await translateBatch(fresh(), { ...base, cli: "codex" }, "youtube");
  assert.strictEqual(r.model, "Codex · gpt-5.4-mini", "codex 應回報後端＋模型");

  // claude alias：host 未回報實際模型（舊版 host）→ 標「家族 最新」
  r = await translateBatch(fresh(), { ...base, cli: "claude" }, "youtube");
  assert.strictEqual(r.model, "Claude · Haiku 最新", "claude alias 應顯示 Haiku 最新");

  // 自動最新的重點：host 回報別名實際解析成的版本 → 標籤顯示真實版本，新模型上線即自動正確
  state.model = "claude-opus-5-5";
  r = await translateBatch(fresh(), { ...base, cli: "claude", claudeModel: "opus" }, "youtube");
  assert.strictEqual(r.model, "Claude · Opus 5.5", "應顯示 host 回報的實際版本，而非別名");
  state.model = "gpt-6.1-sol";
  r = await translateBatch(fresh(), { ...base, cli: "codex", codexModel: "" }, "youtube");
  assert.strictEqual(r.model, "Codex · gpt-6.1-sol", "codex 自動應顯示 host 回報的實際版本");
  state.model = undefined;
  // codex 自動（"" 須過白名單，不可被打回其他預設）且 host 未回報 → 標「自動」
  r = await translateBatch(fresh(), { ...base, cli: "codex", codexModel: "" }, "youtube");
  assert.strictEqual(r.model, "Codex · 自動", "codex 自動且無回報 → 顯示自動");

  // claude 版本字串 → 美化成「家族 版本號」(opus/sonnet/haiku 皆然)
  r = await translateBatch(fresh(), { ...base, cli: "claude", claudeModel: "claude-opus-4-7" }, "youtube");
  assert.strictEqual(r.model, "Claude · Opus 4.7", "claude-opus-4-7 應顯示 Opus 4.7");
  r = await translateBatch(fresh(), { ...base, cli: "claude", claudeModel: "claude-opus-4-6" }, "youtube");
  assert.strictEqual(r.model, "Claude · Opus 4.6", "claude-opus-4-6 應顯示 Opus 4.6");
  r = await translateBatch(fresh(), { ...base, cli: "claude", claudeModel: "claude-sonnet-4-6" }, "youtube");
  assert.strictEqual(r.model, "Claude · Sonnet 4.6", "claude-sonnet-4-6 應顯示 Sonnet 4.6");
  r = await translateBatch(fresh(), { ...base, cli: "claude", claudeModel: "claude-haiku-4-5" }, "youtube");
  assert.strictEqual(r.model, "Claude · Haiku 4.5", "claude-haiku-4-5 應顯示 Haiku 4.5");

  // 第 5 代起無小版本號 → 不可退回原始字串
  r = await translateBatch(fresh(), { ...base, cli: "claude", claudeModel: "claude-opus-5" }, "youtube");
  assert.strictEqual(r.model, "Claude · Opus 5", "claude-opus-5 應顯示 Opus 5");
  r = await translateBatch(fresh(), { ...base, cli: "claude", claudeModel: "claude-sonnet-5" }, "youtube");
  assert.strictEqual(r.model, "Claude · Sonnet 5", "claude-sonnet-5 應顯示 Sonnet 5");

  // agy：預設自動、host 未回報 → 標「自動」；host 從 agy log 讀到實際模型 → 顯示之
  r = await translateBatch(fresh(), { ...base, cli: "agy" }, "youtube");
  assert.strictEqual(r.model, "Antigravity · 自動", "agy 預設自動");
  state.model = "Gemini 3.8 Flash (Low)";
  r = await translateBatch(fresh(), { ...base, cli: "agy" }, "youtube");
  assert.strictEqual(r.model, "Antigravity · Gemini 3.8 Flash (Low)", "agy 應顯示 host 回報的實際模型");
  state.model = undefined;

  // 快取命中時仍要回報模型（同段重翻 → hit）
  const seg = fresh();
  await translateBatch(seg, { ...base, cli: "codex" }, "youtube");
  r = await translateBatch(seg, { ...base, cli: "codex" }, "youtube");
  assert.strictEqual(r.model, "Codex · gpt-5.4-mini", "快取命中時也應回報模型");

  // host fallback：要回報「實際使用」的後端，而非使用者原本要求的
  state.fellBack = true; state.usedCli = "claude";
  r = await translateBatch(fresh(), { ...base, cli: "codex" }, "youtube");
  assert.strictEqual(r.model, "Claude", "fallback 後應回報實際使用的後端");
  // fallback 後 host 有回報實際模型 → 不再只顯示後端名
  state.model = "claude-opus-5-5";
  r = await translateBatch(fresh(), { ...base, cli: "codex" }, "youtube");
  assert.strictEqual(r.model, "Claude · Opus 5.5", "fallback 後有回報 → 顯示實際模型");
  state.fellBack = false; state.usedCli = null; state.model = undefined;

  console.log("✓ sw-model-label: translateBatch 正確回報使用的模型（含 fallback）");
  process.exit(0);
})().catch((e) => {
  console.error("✗ 測試失敗：", e.message);
  process.exit(1);
});

#!/usr/bin/env node
// 驗證「失敗/空的翻譯不進快取」：host 漏回或回空字串(如 CLI 限流、輸出截斷)時，該段不可被
// 當成已譯鎖進快取，否則限流恢復後重翻也只會拿到快取裡的英文/空白。
// 用法：node test/sw-cache-poison.test.js

const assert = require("assert");

const state = { hostCalls: 0, blankIds: new Set() }; // blankIds 內的 id → host 回空字串
function makeFakePort() {
  let onMsg = null;
  return {
    onMessage: { addListener: (cb) => { onMsg = cb; } },
    onDisconnect: { addListener: () => {} },
    postMessage: (m) => {
      state.hostCalls++;
      const result = (m.segments || []).map((s) => ({
        id: s.id,
        zh: state.blankIds.has(s.id) ? "" : "ZH:" + s.text // 模擬限流回空
      }));
      setTimeout(() => onMsg && onMsg({ id: m.id, result, meta: { usedCli: m.cli, fellBack: false } }), 0);
    }
  };
}
const fakePort = makeFakePort();
global.chrome = {
  runtime: {
    onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener() {} },
    connectNative: () => fakePort, getPlatformInfo: (cb) => cb && cb({}),
    get lastError() { return undefined; }
  },
  contextMenus: { onClicked: { addListener() {} }, removeAll: (cb) => cb && cb(), create: () => {} },
  storage: { sync: { get: async () => ({}), set: async () => {} } },
  tabs: { sendMessage: async () => {} },
  scripting: { executeScript: async () => {}, insertCSS: async () => {} }
};
const { translateBatch } = require("../extension/sw.js");
const zhOf = (ret, i) => (Array.isArray(ret) ? ret : ret.results)[i].zh;

const settings = { cli: "codex", codexModel: "gpt-5.4-mini", claudeModel: "haiku", target: "zh-TW", style: "natural", customPrompt: "", glossary: [] };
const segs = [{ id: "a", text: "hello" }, { id: "b", text: "world" }];

(async () => {
  // 1) host 對 b 回空(限流) → a 譯出、b 回退原文顯示，host 呼叫一次
  state.blankIds = new Set(["b"]);
  let r = await translateBatch(segs, settings, "youtube");
  assert.strictEqual(state.hostCalls, 1, "首次應呼叫 host 一次");
  assert.strictEqual(zhOf(r, 0), "ZH:hello", "a 應有譯文");
  assert.notStrictEqual(zhOf(r, 1), "", "b 空譯文不該以空字串呈現(應回退原文)");

  // 2) 再翻同兩段：a 命中快取；b 因未被快取 → 必須重新呼叫 host
  r = await translateBatch(segs, settings, "youtube");
  assert.strictEqual(state.hostCalls, 2, "b 的空譯文不該進快取 → 重翻要再呼叫 host");

  // 3) 這次 host 對 b 正常回譯 → b 取得真實譯文並被快取
  state.blankIds = new Set();
  r = await translateBatch(segs, settings, "youtube");
  assert.strictEqual(state.hostCalls, 3, "b 仍未快取 → 再呼叫 host 取得真譯文");
  assert.strictEqual(zhOf(r, 1), "ZH:world", "b 這次應拿到真實譯文");

  // 4) 再翻 → a、b 都已是真譯文且快取 → 不再呼叫 host
  r = await translateBatch(segs, settings, "youtube");
  assert.strictEqual(state.hostCalls, 3, "兩段都有真譯文並快取 → 不再呼叫 host");

  console.log("✓ sw-cache-poison: 失敗/空譯文不進快取，恢復後重翻可取得真譯文");
  process.exit(0);
})().catch((e) => { console.error("✗ 測試失敗：", e.message); process.exit(1); });

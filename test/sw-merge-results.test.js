// mergeHostResults 純函式測試：encode「不得把漏/空 id 偽裝成原文譯文」
//   - host 漏回某 id → real:false, zh:null（不是原文、不是空字串偽裝成譯文）
//   - host 回空字串/空白 → real:false（限流/截斷常見）
//   - 真譯文 → real:true, zh=該譯文
// 跑法：node test/sw-merge-results.test.js
//
// 為何測這支：bug 的根源就在「把回退顯示值當成翻譯成功」。real 旗標讓上層（youtube worker）
// 能精準分辨「真譯文 vs 未翻譯」，據此重試而非靜默漏譯。
"use strict";
const assert = require("assert");

// sw.js 需要瀏覽器全域；先補最小 stub 再載入（只為取 mergeHostResults 純邏輯）。
// sw.js top-level 會註冊 chrome 事件監聽器，node 無 chrome → 補 no-op stub 才 require 得進去。
global.self = global;
const noopListener = { addListener() {} };
global.chrome = {
  runtime: { onInstalled: noopListener, onStartup: noopListener, onMessage: noopListener },
  contextMenus: { onClicked: noopListener }
};
const { mergeHostResults } = require("../extension/sw.js"); // sw.js 內部會 require ./shared/models.js

let passed = 0;
function t(name, fn) { fn(); passed++; console.log("  ✓ " + name); }

const need = [
  { idx: 0, seg: { id: "0", text: "Hello world." }, key: "k0" },
  { idx: 1, seg: { id: "1", text: "How are you?" }, key: "k1" },
  { idx: 2, seg: { id: "2", text: "Goodbye." }, key: "k2" }
];

console.log("mergeHostResults:");

t("host 漏回 id=1 → 該筆 real:false, zh:null（不得偽裝成原文）", () => {
  const hostResult = [
    { id: "0", zh: "你好世界。" },
    { id: "2", zh: "再見。" }
  ];
  const merged = mergeHostResults(need, hostResult);
  const byIdx = new Map(merged.map((m) => [m.idx, m]));
  assert.strictEqual(byIdx.get(0).real, true);
  assert.strictEqual(byIdx.get(0).zh, "你好世界。");
  assert.strictEqual(byIdx.get(1).real, false, "漏回的 id 必須 real:false");
  assert.strictEqual(byIdx.get(1).zh, null, "漏回的 id 不可被代換成原文，必須 null");
  assert.strictEqual(byIdx.get(2).real, true);
});

t("host 回空字串/空白 → real:false", () => {
  const hostResult = [
    { id: "0", zh: "" },
    { id: "1", zh: "   " },
    { id: "2", zh: "再見。" }
  ];
  const merged = mergeHostResults(need, hostResult);
  const byIdx = new Map(merged.map((m) => [m.idx, m]));
  assert.strictEqual(byIdx.get(0).real, false, "空字串不算譯文");
  assert.strictEqual(byIdx.get(1).real, false, "純空白不算譯文");
  assert.strictEqual(byIdx.get(2).real, true);
});

t("全部命中 → 全 real:true 且 zh 正確", () => {
  const hostResult = need.map((n) => ({ id: n.seg.id, zh: "譯-" + n.seg.id }));
  const merged = mergeHostResults(need, hostResult);
  assert.ok(merged.every((m) => m.real === true));
  assert.strictEqual(merged.find((m) => m.idx === 1).zh, "譯-1");
});

console.log("mergeHostResults: " + passed + " passed\n");

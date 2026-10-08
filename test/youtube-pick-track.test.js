// pickTrack 測試：要翻的是影片口說語言的「人工字幕」，ASR 只是退路。
//   ASR 軌的 languageCode 常是裸語言碼（"en"），人工軌則常帶地區（"en-US"）—
//   若以完整字串比對，人工字幕永遠對不上，就會退回品質差的 ASR。
// youtube.js 是碰 DOM 的 IIFE，無法 require → 從原始碼截出 pickTrack 在 vm 裡跑。
// 跑法：node test/youtube-pick-track.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "../extension/content/youtube.js"), "utf8");
const start = src.indexOf("  function pickTrack(pr) {");
assert.ok(start !== -1, "youtube.js 找不到 pickTrack");
const end = src.indexOf("\n  }\n", start) + "\n  }".length;
const pickTrack = vm.runInNewContext("(" + src.slice(start, end).trim() + ")");

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

const pr = (tracks) => ({ captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } });

console.log("pickTrack:");

t("ASR 是 en、人工是 en-US → 選人工字幕", () => {
  const manual = { languageCode: "en-US" };
  const r = pickTrack(pr([{ languageCode: "en", kind: "asr" }, manual]));
  assert.strictEqual(r.track, manual);
});

t("其他語言的地區碼（pt-BR）也對得上", () => {
  const manual = { languageCode: "pt-BR" };
  const r = pickTrack(pr([{ languageCode: "pt", kind: "asr" }, manual]));
  assert.strictEqual(r.track, manual);
});

t("同語言碼完全相同的人工字幕仍被選中", () => {
  const manual = { languageCode: "ja" };
  const r = pickTrack(pr([{ languageCode: "ja", kind: "asr" }, manual]));
  assert.strictEqual(r.track, manual);
});

t("人工字幕是別的語言 → 不可誤選，退回 ASR", () => {
  const asr = { languageCode: "en", kind: "asr" };
  const r = pickTrack(pr([asr, { languageCode: "ar" }]));
  assert.strictEqual(r.track, asr);
});

t("ASR 是中文 → 無需翻譯", () => {
  const r = pickTrack(pr([{ languageCode: "zh-TW", kind: "asr" }, { languageCode: "en" }]));
  assert.strictEqual(r.track, null);
  assert.strictEqual(r.allChinese, true);
});

console.log(passed + " passed");

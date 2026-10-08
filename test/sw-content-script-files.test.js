// contentScriptFiles 純函式測試：on-demand 注入清單必須滿足相依順序。
//   - article.js:208 / youtube.js:833 呼叫 window.aiyuCreateSearchBox（由 search-box.js 定義）
//     → search-box.js 在注入清單中必須排在它們之前，否則注入後氣泡擲 undefined。
//   - 這支測試的存在意義：後續任務移除常駐 <all_urls> 注入後，on-demand 清單是唯一保證，
//     漏掉 search-box 或順序顛倒都會讓選取翻譯在非 YouTube 頁壞掉（且只在執行期才爆）。
// 跑法：node test/sw-content-script-files.test.js
"use strict";
const assert = require("assert");

// sw.js top-level 會註冊 chrome 事件監聽器；node 無 chrome → 補最小 stub 才 require 得進去。
global.self = global;
const noopListener = { addListener() {} };
global.chrome = {
  runtime: { onInstalled: noopListener, onStartup: noopListener, onMessage: noopListener },
  contextMenus: { onClicked: noopListener }
};
const { contentScriptFiles } = require("../extension/sw.js");

let passed = 0;
function t(name, fn) { fn(); passed++; console.log("  ✓ " + name); }

console.log("contentScriptFiles:");

t("非 YouTube 頁注入 search-box.js + article.js", () => {
  const files = contentScriptFiles("https://en.wikipedia.org/wiki/Aiyu_jelly");
  assert.deepStrictEqual(files, ["content/search-box.js", "content/article.js"]);
});

t("search-box.js 必須排在 article.js 之前（相依順序）", () => {
  const files = contentScriptFiles("https://example.com/");
  const sb = files.indexOf("content/search-box.js");
  const art = files.indexOf("content/article.js");
  assert.ok(sb !== -1, "清單必含 search-box.js");
  assert.ok(art !== -1, "清單必含 article.js");
  assert.ok(sb < art, "search-box.js 必須在 article.js 之前");
});

t("YouTube 頁含 youtube.js，且 search-box 在 youtube/article 之前", () => {
  const files = contentScriptFiles("https://www.youtube.com/watch?v=abc123");
  const sb = files.indexOf("content/search-box.js");
  const yt = files.indexOf("content/youtube.js");
  const art = files.indexOf("content/article.js");
  assert.ok(sb !== -1 && yt !== -1 && art !== -1, "YouTube 清單需含 search-box/youtube/article");
  assert.ok(sb < yt, "search-box 必須在 youtube.js 之前（youtube.js:833 用 aiyuCreateSearchBox）");
  assert.ok(sb < art, "search-box 必須在 article.js 之前");
});

console.log(`\n${passed} passed`);

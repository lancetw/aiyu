// manifest 權限硬化測試：上架前把「讀取所有網站」收斂為 youtube.com。
//   - 移除常駐 <all_urls> content_scripts entry（選取翻譯改走 sw.js 右鍵當下注入）
//   - host_permissions 收斂為 youtube.com only
//   - 但 YouTube 兩個 content_scripts entry 必須保留，否則字幕功能（declarative 注入）會壞
// 跑法：node test/manifest-permissions.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const manifest = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../extension/manifest.json"), "utf8")
);

let passed = 0;
function t(name, fn) { fn(); passed++; console.log("  ✓ " + name); }

console.log("manifest 權限硬化:");

t("沒有任何 content_scripts entry 匹配 <all_urls>", () => {
  const cs = manifest.content_scripts || [];
  const allUrls = cs.filter((e) => (e.matches || []).includes("<all_urls>"));
  assert.strictEqual(allUrls.length, 0, "常駐 <all_urls> 注入必須移除");
});

t("host_permissions 收斂為 youtube.com only", () => {
  assert.deepStrictEqual(manifest.host_permissions, ["*://*.youtube.com/*"]);
});

t("YouTube content_scripts 仍保留：yt-key-shim(world:MAIN) + 主 bundle(含 search-box+youtube)", () => {
  const cs = manifest.content_scripts || [];
  const yt = cs.filter((e) => (e.matches || []).some((m) => m.includes("youtube.com")));
  assert.ok(yt.length >= 2, "需保留 yt-key-shim 與主 bundle 兩個 youtube entry");

  const shim = yt.find((e) => (e.js || []).includes("content/yt-key-shim.js"));
  assert.ok(shim, "yt-key-shim entry 必須存在");
  assert.strictEqual(shim.world, "MAIN", "yt-key-shim 必須 world:MAIN（搶在 YT 前攔 C 鍵）");
  assert.strictEqual(shim.run_at, "document_start", "yt-key-shim 必須 document_start");

  const bundle = yt.find((e) => (e.js || []).includes("content/youtube.js"));
  assert.ok(bundle, "youtube 主 bundle entry 必須存在");
  assert.ok((bundle.js || []).includes("content/search-box.js"), "主 bundle 仍須含 search-box.js");
});

console.log(`\n${passed} passed`);

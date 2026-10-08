#!/usr/bin/env node
// 驗證 hostOutdated：擴充據此提示使用者更新本機 host。
// 舊 host 會默默少掉新功能（agy 隔離、實際模型回報…）而不報錯，這個檢查是使用者唯一的訊號。
// 用法：node test/host-version.test.js

const assert = require("assert");
const { hostOutdated } = require("../extension/shared/models.js");

// 0.5.0 以前的 host ping 不回版本 → 必須視為過舊，否則升級前的使用者永遠收不到提示
assert.strictEqual(hostOutdated(undefined, "0.5.1"), true, "沒回版本＝舊 host");
assert.strictEqual(hostOutdated("", "0.5.1"), true, "空字串＝舊 host");

// 只比 major.minor：patch 版只改擴充端時不可誤報
assert.strictEqual(hostOutdated("0.5.0", "0.5.1"), false, "patch 差異不算過舊");
assert.strictEqual(hostOutdated("0.5.1", "0.5.1"), false, "同版");
assert.strictEqual(hostOutdated("0.4.6", "0.5.1"), true, "minor 落後");
assert.strictEqual(hostOutdated("0.9.0", "1.0.0"), true, "major 落後");
// host 比擴充新（擴充還沒過 CWS 審核）→ 不要叫使用者更新 host
assert.strictEqual(hostOutdated("0.6.0", "0.5.1"), false, "host 較新不算過舊");
// 數值比較而非字串：0.10 > 0.9
assert.strictEqual(hostOutdated("0.10.0", "0.9.0"), false, "0.10 不可被當成小於 0.9");
assert.strictEqual(hostOutdated("0.9.0", "0.10.0"), true, "0.9 落後 0.10");

console.log("✓ host-version: hostOutdated 只在 host 的 major.minor 落後（或未回版本）時為真");

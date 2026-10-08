#!/usr/bin/env node
// 驗證推理強度解析：送進 CLI 的 effort 必須是該模型實測接受的值，否則 CLI 直接 exit 1。
// 用法：node test/models-effort.test.js

const assert = require("assert");
const { resolveModel, resolveEffort, MODEL_DEFAULTS } = require("../extension/shared/models.js");

const s = (over) => ({ ...MODEL_DEFAULTS, ...over });

// 預設＝自動：不帶參數，維持各 CLI（與 host 的 codex low/medium）既有行為
for (const cli of ["codex", "claude", "agy"]) assert.strictEqual(resolveEffort(s({ cli })), "");

// agy 指定型號不帶 --effort 會 exit 1 → 存的 "" 也必須落到該型號第一個可用值
assert.strictEqual(resolveEffort(s({ cli: "agy", agyModel: "gemini-3.8-flash" })), "low");
assert.strictEqual(resolveEffort(s({ cli: "agy", agyModel: "gpt-oss-120b", agyEffort: "high" })), "medium");
// gemini-3.1-pro 只有 low/high
assert.strictEqual(resolveEffort(s({ cli: "agy", agyModel: "gemini-3.1-pro", agyEffort: "medium" })), "low");
assert.strictEqual(resolveEffort(s({ cli: "agy", agyModel: "gemini-3.1-pro", agyEffort: "high" })), "high");

// 0.5.x 舊 slug：拆成基本型號＋強度，不打回自動
const legacy = s({ cli: "agy", agyModel: "claude-opus-5-5-high" });
assert.strictEqual(resolveModel(legacy), "claude-opus-5-5");
assert.strictEqual(resolveEffort(legacy), "high");
// 之後使用者在強度下拉另選 → 以新選的為準
assert.strictEqual(resolveEffort({ ...legacy, agyEffort: "low" }), "low");
// 不認得的舊 slug → 自動
assert.strictEqual(resolveModel(s({ cli: "agy", agyModel: "gemini-9-flash-low" })), "");

// codex：gpt-5.4/5.5 不收 max（OpenAI 400）→ 退回自動；新模型可用 max
assert.strictEqual(resolveEffort(s({ cli: "codex", codexModel: "gpt-5.4-mini", codexEffort: "max" })), "");
assert.strictEqual(resolveEffort(s({ cli: "codex", codexModel: "gpt-6-luna", codexEffort: "max" })), "max");

// claude：清單外的完整模型 id 仍可設強度
assert.strictEqual(resolveEffort(s({ cli: "claude", claudeModel: "claude-opus-9", claudeEffort: "xhigh" })), "xhigh");

// 無模型清單的後端 → null（host 不帶參數）
assert.strictEqual(resolveEffort({ cli: "nope" }), null);

console.log("models-effort ok");

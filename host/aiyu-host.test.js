// agy 未登入時，每個 agy 程序都會自己開一個 Google 登入視窗、卡約 60 秒才失敗。
// 擴充並行送 4 組字幕 → host 不可同時起 4 個 agy（＝4 個登入視窗）。
// 用假 agy（AIYU_AGY_PATH）記錄每次啟動與同時在跑的數量。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOST = path.join(path.dirname(fileURLToPath(import.meta.url)), "aiyu-host.js");

const AGY_ENDINGS = {
  ok: `echo '[{"id":"1","zh":"你好"}]'`,
  loggedOut: `echo "Authentication required. Please visit the URL to log in:" >&2; exit 1`,
  badModel: `echo 'error: invalid model selection (--model "claude-sonnet-5-5-low" --effort ""): model claude-sonnet-5-5-low is not recognized as a known model or custom model in settings' >&2; exit 1`
};

function fakeAgy(dir, { loggedIn, ending = loggedIn ? AGY_ENDINGS.ok : AGY_ENDINGS.loggedOut }) {
  const bin = path.join(dir, "agy");
  fs.writeFileSync(bin, `#!/bin/sh
echo x >> "${dir}/spawns"
touch "${dir}/run.$$"
ls "${dir}"/run.* | wc -l >> "${dir}/peaks"
sleep 0.5
rm "${dir}/run.$$"
${ending}
`, { mode: 0o755 });
  return bin;
}

// 同時送 n 筆 translate，收齊回覆後關掉 host。
function translateConcurrently(bin, dir, n) {
  return new Promise((resolve, reject) => {
    const host = spawn(process.execPath, [HOST], {
      env: { ...process.env, AIYU_AGY_PATH: bin, AIYU_LOG: path.join(dir, "host.log") },
      stdio: ["pipe", "pipe", "inherit"]
    });
    const replies = [];
    let buf = Buffer.alloc(0);
    host.stdout.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) {
        const len = buf.readUInt32LE(0);
        replies.push(JSON.parse(buf.subarray(4, 4 + len).toString("utf8")));
        buf = buf.subarray(4 + len);
        if (replies.length === n) { host.stdin.end(); resolve(replies); }
      }
    });
    host.on("error", reject);
    for (let id = 1; id <= n; id++) {
      const json = Buffer.from(JSON.stringify({
        id, action: "translate", cli: "agy", context: "youtube",
        segments: [{ id: "1", text: "hello" }]
      }));
      const len = Buffer.alloc(4);
      len.writeUInt32LE(json.length);
      host.stdin.write(Buffer.concat([len, json]));
    }
  });
}

const lines = (f) => fs.readFileSync(f, "utf8").trim().split("\n");
const peak = (dir) => Math.max(...lines(path.join(dir, "peaks")).map(Number));

test("agy not logged in: concurrent requests spawn one agy and all get the login error", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiyu-agy-auth-"));
  const replies = await translateConcurrently(fakeAgy(dir, { loggedIn: false }), dir, 4);
  assert.equal(lines(path.join(dir, "spawns")).length, 1, "only one agy (one login window) may run");
  for (const r of replies) assert.match(r.error, /agy 需要登入/);
});

test("agy logged in: once the first call succeeds the rest run in parallel", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiyu-agy-ok-"));
  const replies = await translateConcurrently(fakeAgy(dir, { loggedIn: true }), dir, 4);
  for (const r of replies) assert.deepEqual(r.result, [{ id: "1", zh: "你好" }]);
  assert.equal(lines(path.join(dir, "spawns")).length, 4);
  assert.ok(peak(dir) >= 2, `expected parallel agy after login confirmed, peak=${peak(dir)}`);
});

// 型號被拒是決定性錯誤：重試同一型號只會再等 7 秒拿到同一個錯 → 帶固定關鍵字「型號無效」讓擴充中止整輪。
test("agy rejects the model: concurrent requests spawn one agy and all get the invalid-model error", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiyu-agy-model-"));
  const replies = await translateConcurrently(fakeAgy(dir, { ending: AGY_ENDINGS.badModel }), dir, 4);
  assert.equal(lines(path.join(dir, "spawns")).length, 1, "the same rejected model must not be retried per request");
  for (const r of replies) assert.match(r.error, /agy 型號無效/);
});

// claude、codex 的型號錯誤字串（實測 CLI 輸出）也要被辨識；分類不看是哪個 CLI，借假 agy 送出即可。
for (const [name, msg] of [
  ["claude", "There's an issue with the selected model (bogus-model-xyz). It may not exist or you may not have access to it. Run --model to pick a different model."],
  ["codex", "ERROR: The model `bogus-model-xyz` does not exist or you do not have access to it."]
]) {
  test(`${name}'s model-rejection wording is classified as invalid model`, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aiyu-model-wording-"));
    const [r] = await translateConcurrently(fakeAgy(dir, { ending: `echo ${JSON.stringify(msg).replace(/`/g, "\\`")} >&2; exit 1` }), dir, 1);
    assert.match(r.error, /型號無效/);
  });
}

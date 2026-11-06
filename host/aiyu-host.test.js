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

function fakeAgy(dir, { loggedIn }) {
  const bin = path.join(dir, "agy");
  const ending = loggedIn
    ? `echo '[{"id":"1","zh":"你好"}]'`
    : `echo "Authentication required. Please visit the URL to log in:" >&2; exit 1`;
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

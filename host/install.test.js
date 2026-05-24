import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBrowsersFlag, resolveSelection } from "./install.js";

const installJs = fileURLToPath(new URL("./install.js", import.meta.url));

test("parseBrowsersFlag: trim/小寫/去重/分流 known|unknown", () => {
  const r = parseBrowsersFlag(" Chrome , brave,chrome , nope ");
  assert.deepEqual(r.known, ["chrome", "brave"]);
  assert.deepEqual(r.unknown, ["nope"]);
});

test("parseBrowsersFlag: 過濾空 token", () => {
  const r = parseBrowsersFlag("chrome,,");
  assert.deepEqual(r.known, ["chrome"]);
  assert.deepEqual(r.unknown, []);
});

test("resolveSelection: --browsers 優先 → known 清單", () => {
  const r = resolveSelection({ browsersFlag: "chrome,nope", all: false, isTTY: true, detectedIds: ["chrome", "brave"] });
  assert.deepEqual(r, { mode: "list", ids: ["chrome"] });
});

test("resolveSelection: --all → 全部偵測到的", () => {
  const r = resolveSelection({ browsersFlag: null, all: true, isTTY: true, detectedIds: ["chrome", "brave"] });
  assert.deepEqual(r, { mode: "list", ids: ["chrome", "brave"] });
});

test("resolveSelection: TTY 無旗標 → 互動", () => {
  const r = resolveSelection({ browsersFlag: null, all: false, isTTY: true, detectedIds: ["chrome"] });
  assert.deepEqual(r, { mode: "interactive" });
});

test("resolveSelection: 非 TTY 無旗標 → 全裝（保護 auto-deploy）", () => {
  const r = resolveSelection({ browsersFlag: null, all: false, isTTY: false, detectedIds: ["chrome", "brave", "edge"] });
  assert.deepEqual(r, { mode: "list", ids: ["chrome", "brave", "edge"] });
});

test("resolveSelection: 空字串 browsersFlag 視同 null（falsy 落到後續分支）", () => {
  assert.deepEqual(
    resolveSelection({ browsersFlag: "", all: false, isTTY: true, detectedIds: ["chrome"] }),
    { mode: "interactive" }
  );
  assert.deepEqual(
    resolveSelection({ browsersFlag: "", all: false, isTTY: false, detectedIds: ["chrome"] }),
    { mode: "list", ids: ["chrome"] }
  );
});

test("經 symlink 啟動（npx/.bin 情境）時 main() 仍會執行", () => {
  // npx 透過 node_modules/.bin/<name> symlink 啟動 bin：process.argv[1] 是 symlink 路徑，
  // 而 import.meta.url 是 realpath 解析後的真實檔。守衛若用字串相等比對會誤判 → main() 不跑、零輸出。
  const dir = mkdtempSync(path.join(tmpdir(), "aiyu-bin-"));
  const link = path.join(dir, "aiyu");
  symlinkSync(installJs, link);
  const out = execFileSync(process.execPath, [link, "--help"], { encoding: "utf8" });
  assert.match(out, /native host 安裝器/); // 有印出 help banner = main() 透過 symlink 也有跑
});

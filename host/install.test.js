import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrowsersFlag, resolveSelection } from "./install.js";

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

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, readFileSync, writeFileSync, existsSync, lstatSync, readdirSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseBrowsersFlag, resolveSelection, pickInteractive } from "./install.js";

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

test("pickInteractive: 沒偵測到瀏覽器 → 回空陣列，不把空選單丟給 clack（clack 會崩潰）", async () => {
  assert.deepEqual(await pickInteractive([]), []);
});

// 假 flatpak：$HOME/fp/<id> 存在 = 已安裝，內容 = 權限；每次呼叫記在 $HOME/fp-calls。
const FAKE_FLATPAK = `#!/bin/sh
echo "$*" >> "$HOME/fp-calls"
case "$1" in
  info) if [ "$2" = --show-permissions ]; then cat "$HOME/fp/$3"; else [ -e "$HOME/fp/$2" ]; fi ;;
  override) echo "org.freedesktop.Flatpak=talk" >> "$HOME/fp/$4" ;;
esac
`;

// 在假 HOME 裡跑安裝器；只帶 PATH，避免 XDG_* 把寫入導向真實家目錄。
// 一律墊上假 flatpak：否則會打到真的 flatpak，改到本機瀏覽器的權限。
function runInstaller(home, args) {
  mkdirSync(path.join(home, "bin"), { recursive: true });
  writeFileSync(path.join(home, "bin/flatpak"), FAKE_FLATPAK, { mode: 0o755 });
  mkdirSync(path.join(home, "fp"), { recursive: true });
  const r = spawnSync(process.execPath, [installJs, ...args], {
    encoding: "utf8",
    env: { PATH: `${path.join(home, "bin")}:${process.env.PATH}`, HOME: home },
  });
  if (r.status !== 0) throw new Error(`installer exit ${r.status}: ${r.stderr}`);
  return r;
}

const calls = (home) => (existsSync(path.join(home, "fp-calls")) ? readFileSync(path.join(home, "fp-calls"), "utf8") : "");

test("linux: Flatpak Chrome → manifest 指向 sandbox 內可見的 wrapper，wrapper 經 flatpak-spawn 回主機跑 launcher", { skip: process.platform !== "linux" }, () => {
  const { home, cfg } = flatpakHome();
  runInstaller(home, ["--all"]);

  const nmh = path.join(cfg, "NativeMessagingHosts");
  const manifest = JSON.parse(readFileSync(path.join(nmh, "com.lancetw.aiyu.json"), "utf8"));
  const wrapper = path.join(nmh, "aiyu-host-flatpak.sh");
  assert.equal(manifest.path, wrapper);
  const launcher = path.join(home, ".local/share/aiyu/aiyu-host-launcher.sh");
  assert.match(readFileSync(wrapper, "utf8"), new RegExp(`exec flatpak-spawn --host "${launcher}" "\\$@"`));

  runInstaller(home, ["--uninstall"]);
  assert.equal(existsSync(wrapper), false);
});

test("linux: 只剩 ~/.var/app 殘留設定、Flatpak 已移除 → 不算偵測到", { skip: process.platform !== "linux" }, () => {
  const home = mkdtempSync(path.join(tmpdir(), "aiyu-home-"));
  const cfg = path.join(home, ".var/app/org.chromium.Chromium/config/chromium");
  mkdirSync(cfg, { recursive: true });
  runInstaller(home, ["--all"]);
  assert.equal(existsSync(path.join(cfg, "NativeMessagingHosts")), false);
  assert.doesNotMatch(calls(home), /override/);
});

test("linux: Flatpak 瀏覽器沒有 talk 權限 → 安裝器代跑 override，並確認生效", { skip: process.platform !== "linux" }, () => {
  const { home } = flatpakHome();
  runInstaller(home, ["--all"]);
  assert.match(calls(home), /^override --user --talk-name=org\.freedesktop\.Flatpak com\.google\.Chrome$/m);
  assert.match(readFileSync(path.join(home, "fp/com.google.Chrome"), "utf8"), /org\.freedesktop\.Flatpak=talk/);
});

test("linux: 已有 talk 權限 → 不重跑 override", { skip: process.platform !== "linux" }, () => {
  const { home } = flatpakHome("org.freedesktop.Flatpak=talk\n");
  runInstaller(home, ["--all"]);
  assert.doesNotMatch(calls(home), /override/);
});

test("linux: override 沒生效 → 大聲提示手動指令", { skip: process.platform !== "linux" }, () => {
  const { home } = flatpakHome();
  chmodSync(path.join(home, "fp/com.google.Chrome"), 0o444); // 假 flatpak 寫不進權限 = 授權失敗
  const r = runInstaller(home, ["--all"]);
  assert.match(r.stderr, /flatpak override --user --talk-name=org\.freedesktop\.Flatpak com\.google\.Chrome/);
});

test("linux: --dry-run 不代跑 override", { skip: process.platform !== "linux" }, () => {
  const { home } = flatpakHome();
  runInstaller(home, ["--all", "--dry-run"]);
  assert.doesNotMatch(calls(home), /override/);
});

// 已安裝 Flatpak Chrome 的假 HOME（perms = 目前權限）。~/.var/app/<id> 在 sandbox 內可寫，symlink 測試也用它。
function flatpakHome(perms = "") {
  const home = mkdtempSync(path.join(tmpdir(), "aiyu-home-"));
  mkdirSync(path.join(home, "fp"));
  writeFileSync(path.join(home, "fp/com.google.Chrome"), perms);
  const cfg = path.join(home, ".var/app/com.google.Chrome/config/google-chrome");
  mkdirSync(cfg, { recursive: true });
  const victim = path.join(home, "victim");
  writeFileSync(victim, "keep");
  return { home, cfg, victim };
}

test("linux: Flatpak NMH 目錄裡的檔案是 symlink → 不跟隨，sandbox 外的檔案不被覆寫", { skip: process.platform !== "linux" }, () => {
  const { home, cfg, victim } = flatpakHome();
  mkdirSync(path.join(cfg, "NativeMessagingHosts"));
  symlinkSync(victim, path.join(cfg, "NativeMessagingHosts/aiyu-host-flatpak.sh"));
  symlinkSync(victim, path.join(cfg, "NativeMessagingHosts/com.lancetw.aiyu.json"));
  runInstaller(home, ["--all"]);
  assert.equal(readFileSync(victim, "utf8"), "keep");
  assert.equal(lstatSync(path.join(cfg, "NativeMessagingHosts/aiyu-host-flatpak.sh")).isSymbolicLink(), false);
});

test("linux: Flatpak NMH 目錄本身是 symlink → 拒絕寫入", { skip: process.platform !== "linux" }, () => {
  const { home, cfg } = flatpakHome();
  const outside = path.join(home, "outside");
  mkdirSync(outside);
  symlinkSync(outside, path.join(cfg, "NativeMessagingHosts"));
  assert.throws(() => runInstaller(home, ["--all"]));
  assert.deepEqual(readdirSync(outside), []);
});

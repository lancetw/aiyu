#!/usr/bin/env node
// 測 model 參數有沒有帶到 CLI
// 用法：node host/smoke-model.js <claude|codex> <model>
const { spawn } = require("child_process");
const path = require("path");

const cli = process.argv[2] || "claude";
const model = process.argv[3] || (cli === "codex" ? "gpt-5.4-mini" : "haiku");

const host = spawn(process.execPath, [path.join(__dirname, "aiyu-host.js")], {
  stdio: ["pipe", "pipe", "inherit"]
});

function send(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  host.stdin.write(len);
  host.stdin.write(json);
}

let buf = Buffer.alloc(0);
host.stdout.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const msg = JSON.parse(buf.slice(4, 4 + len).toString("utf8"));
    buf = buf.slice(4 + len);
    console.log("◀", JSON.stringify(msg, null, 2));
    host.stdin.end();
  }
});
host.on("exit", (c) => console.log("host exit", c));

console.log(`▶ translate via cli=${cli} model=${model}`);
send({
  id: 1,
  action: "translate",
  cli,
  model,
  target: "zh-TW",
  style: "natural",
  glossary: [],
  customPrompt: "",
  segments: [{ id: "m1", text: "The cheapest model is usually fast enough for translation." }]
});

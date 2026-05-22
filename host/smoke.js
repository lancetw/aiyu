#!/usr/bin/env node
// 模擬 Chrome：往 aiyu-host 發兩則訊息（ping + translate 一段），印出回應
// 用法：node host/smoke.js [claude|codex]

const { spawn } = require("child_process");
const path = require("path");

const cli = process.argv[2] || "claude";
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
    const body = buf.slice(4, 4 + len).toString("utf8");
    buf = buf.slice(4 + len);
    const msg = JSON.parse(body);
    console.log("◀", JSON.stringify(msg, null, 2));
    if (msg.id === 2) {
      host.stdin.end();
    }
  }
});

host.on("exit", (code) => {
  console.log("host exited", code);
});

send({ id: 1, action: "ping" });
send({
  id: 2,
  action: "translate",
  cli,
  target: "zh-TW",
  style: "natural",
  glossary: [
    ["軟件", "軟體"],
    ["視頻", "影片"]
  ],
  customPrompt: "",
  segments: [
    { id: "a", text: "Native messaging hosts run as separate processes." },
    { id: "b", text: "Please watch this short software video." }
  ]
});

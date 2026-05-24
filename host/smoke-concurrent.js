#!/usr/bin/env node
// 模擬 sw.js 同時發 3 筆 translate 請求，檢查 host 不會混淆 id
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
let received = 0;
host.stdout.on("data", (d) => {
  buf = Buffer.concat([buf, d]);
  while (buf.length >= 4) {
    const len = buf.readUInt32LE(0);
    if (buf.length < 4 + len) break;
    const body = buf.slice(4, 4 + len).toString("utf8");
    buf = buf.slice(4 + len);
    const msg = JSON.parse(body);
    received++;
    console.log(`◀ id=${msg.id}`, msg.error ? "ERR " + msg.error : JSON.stringify(msg.result));
    if (received === 3) host.stdin.end();
  }
});

host.on("exit", (c) => console.log("exit", c));

const inputs = [
  { id: 10, text: "Hello world." },
  { id: 11, text: "The quick brown fox jumps over the lazy dog." },
  { id: 12, text: "Modern software is built on layers of abstraction." }
];

for (const inp of inputs) {
  send({
    id: inp.id,
    action: "translate",
    cli: "claude",
    target: "zh-TW",
    style: "natural",
    glossary: [],
    customPrompt: "",
    segments: [{ id: String(inp.id), text: inp.text }]
  });
}

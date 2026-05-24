# @lancetw/aiyu

Native-messaging **host installer** for the [aiyu](https://github.com/lancetw/aiyu) Chrome extension (*aiyu — AI 譯語*), which translates **YouTube subtitles** and **selected web text** into Traditional Chinese (Taiwan) using an AI CLI already on your own machine.

This npm package is the **host half**. It registers a small local bridge so the aiyu browser extension can call your installed `claude` / `codex` / `agy` CLI. The extension itself is installed from the Chrome Web Store.

## Install

```sh
npx @lancetw/aiyu
```

Then restart your browser, click the aiyu icon → **「測試 host 連線」** (Test host connection).

## Requirements

- **Node.js ≥ 20.12**
- One of these AI CLIs installed **and signed in** (requires that service's account):
  - `claude` — Anthropic Claude Code
  - `codex` — OpenAI Codex
  - `agy` — Google Antigravity
- The **aiyu** extension installed from the Chrome Web Store

> Without a CLI or without running this installer, the extension shows **「連線失敗」(connection failed)**. macOS / Linux are verified; Windows is experimental.

## Uninstall

```sh
npx @lancetw/aiyu --uninstall
```

## What it does

`npx @lancetw/aiyu` copies the host to a stable location, generates a launcher pinned to your Node binary (no reliance on a shebang), and registers the native-messaging manifest for each detected Chromium-based browser (Chrome / Chromium / Edge / Brave / Arc). The host trusts both the off-store (unpacked-dev) and Chrome Web Store extension IDs, so either build connects.

## Privacy

aiyu has **no developer server** and collects no data. The text you translate goes only — under your own account, via the CLI you installed — to that provider (Anthropic / OpenAI / Google); it never passes through the developer. See the [privacy policy](https://github.com/lancetw/aiyu/blob/master/PRIVACY.md).

## License

[MIT](https://github.com/lancetw/aiyu/blob/master/LICENSE) © lancetw

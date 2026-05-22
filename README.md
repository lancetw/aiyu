# aiyu — AI 譯語

一個專注於 **YouTube 字幕翻譯** 的 Chrome 擴充套件，呼叫本機的 `claude`、`codex` 或 `agy`（Antigravity）CLI，把字幕翻成 **台灣正體中文**（也可翻譯網頁上選取的文字）。

> **狀態**：MVP / 0.1.1
> **平台**：macOS（Linux 應可，Windows 未測）
> **瀏覽器**：Chrome / Chromium / Edge / Brave / Arc

---

## 架構

```
┌──────────────────────────┐         stdio (4-byte LE + JSON)         ┌────────────────────┐
│  Chrome 擴充套件 (MV3)    │ ◀──────────────────────────────────────▶ │  aiyu-host (Node)  │
│  • content/youtube.js    │                                          │  spawn claude / codex │
│  • content/article.js    │                                          └──────────┬─────────┘
│  • sw.js (cache+router)  │                                                     │
│  • popup / options       │                                                     ▼
└──────────────────────────┘                                              claude -p / codex exec
```

關鍵設計：

- **Service Worker** 作為翻譯路由：LRU 快取（避免重複呼叫 CLI）、批次合併、與 native host 維持 long-lived port。
- **YouTube** 預先抓整條字幕軌、分批送 CLI 翻譯，再以時間碼同步、用 overlay 把雙語字幕疊在 player 上（`content/youtube.js`）。
- **選取文字** 在任意網頁選取後，右鍵「aiyu：翻譯選取文字」，譯文顯示在可拖曳縮放的浮動視窗（譯上原下／左右並排可切換、可搜尋）（`content/article.js`）。
- **共用搜尋元件**（`content/search-box.js`）：逐字稿面板與選取翻譯視窗共用同一條關鍵字搜尋／高亮／逐處導覽列。
- **譯者人格依情境切換**：字幕走「即時口譯」、選取文字走「資深翻譯記者」（在 host 的 system prompt 內切換）。
- **詞庫** 注入 system prompt，不做後處理替換 — 模型會理解上下文，避免「程序員→程式員」這類災難。

---

## 安裝

### 1. 載入擴充套件

1. 開啟 `chrome://extensions`
2. 開啟 **「開發人員模式」**
3. 點 **「載入未封裝項目」**，選擇本專案的 `extension/` 資料夾
4. 複製 Chrome 顯示出的 **Extension ID**（一串 32 位小寫字母）

### 2. 安裝 native host

```bash
cd host
./install.sh <貼上的 Extension ID>
```

腳本會把 host 程式**複製**到 `~/Library/Application Support/aiyu/`（macOS TCC 會擋 Chrome
存取 `~/Documents`、`~/Desktop` 下的 script，故 host 必須住在 Application Support），
並把 `com.lancetw.aiyu.json` 寫入瀏覽器的 `NativeMessagingHosts/` 目錄。
支援 Chrome / Chrome Canary / Chromium / Edge / Brave / Arc，全部偵測到的都會裝。

### 3. 確認 CLI 可用

aiyu 預期下列任一執行檔已可呼叫：

- `codex`（OpenAI Codex CLI，預設）
- `claude`（Anthropic Claude Code CLI）
- `agy`（Google Antigravity CLI；以 `agy -p` 呼叫。模型由帳號端自動路由，無法在 aiyu 指定）

預設會去找這些路徑：
`/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`、`~/.nvm/...`

若你的安裝路徑不同，可在 shell profile 裡設定：

```bash
export AIYU_CLAUDE_PATH=/your/path/to/claude
export AIYU_CODEX_PATH=/your/path/to/codex
export AIYU_AGY_PATH=/your/path/to/agy
```

### 4. 重啟瀏覽器

關掉所有 Chrome 視窗再開（讓 Native Messaging 重新註冊）。

### 5. 測試

點擴充套件圖示 → 「測試 host 連線」。應顯示「連線成功：aiyu-host」。

> **修改後如何生效（重要）**
>
> 前端與 host 的更新方式**不對稱**：
> - **前端**（`extension/`：`youtube.js`、`sw.js`、`manifest.json`…）：`chrome://extensions` 重新載入 + **重整該分頁**即生效（content script 在頁面載入時注入，舊分頁不會自動更新）。
> - **host**（`host/aiyu-host.js`）：**不會自動同步**到瀏覽器實際啟動的位置。改完必須重新部署：
>   ```bash
>   ./host/deploy.sh        # 只複製 host，不動 manifest
>   ```
>   再到 `chrome://extensions` 重新載入 aiyu（讓常駐的舊 host 行程退場、下次翻譯啟動新碼）。

---

## 使用

- **YouTube**：開啟有字幕的影片，點播放列上的「譯」按鈕；譯文會以雙語字幕疊在播放器上（字幕框可拖曳、滾輪縮放字級）。右上角徽章顯示進度／狀態（含「翻譯額度用盡」）。把游標移到「譯」按鈕會展開選單：**開啟中英對照字幕**（可拖曳縮放的逐字稿面板，自動跟隨高亮、點句跳轉、可搜尋）與**下載中英對照 SRT**。
- **選取文字**：在任意網頁選取一段文字 → 右鍵「aiyu：翻譯選取文字」→ 譯文顯示在浮動視窗（可拖曳、縮放、調整字級、切換譯上原下／左右並排、關鍵字搜尋）。
- **設定**：點圖示開啟 popup（後端 CLI、模型、目標語言、風格）；點「進階設定」可編輯詞庫與自訂提示詞。

---

## 設定項

| 設定 | 預設 | 說明 |
|---|---|---|
| `cli` | `codex` | 使用 `codex exec`、`claude -p` 或 `agy -p`（Antigravity 無模型可選） |
| `model` | codex=`gpt-5.4-mini`、claude=`haiku` | 各後端使用的模型；Antigravity 由帳號端自動路由，無此選項 |
| `target` | `zh-TW` | 目標語言（繁中台灣 / 簡中 / 英 / 日） |
| `style` | `natural` | natural / literal / academic |
| `glossary` | 內建約 200 條 | 對岸詞 → 台灣詞對照 |
| `customPrompt` | 空 | 額外 system prompt 追加 |

---

## 已知限制 / 不做的事

- 不做 PDF 翻譯
- 不做整篇網頁文章逐段翻譯（僅支援「選取文字」翻譯）
- 不做語音辨識（YouTube 沒有字幕的影片就跳過）
- 每次 CLI spawn 約 1–3 秒，首段翻譯會明顯停頓；後續段落因 cache + 並行較快
- Native host 不能透過 Chrome Web Store 散布，使用者必須手動跑 `install.sh`

---

## 除錯

- Native host 的 stderr 與動作 log 寫到：`~/Library/Application Support/aiyu/aiyu-host.log`（可用 `AIYU_LOG` 覆寫）
- Service worker log：`chrome://extensions` → 點此擴充套件的「Service worker」開 DevTools
- Content script log：頁面右鍵 → 檢查 → Console

常見問題：

| 症狀 | 原因 |
|---|---|
| popup 顯示「連線失敗：Specified native messaging host not found.」 | `install.sh` 沒對到正確 Extension ID，或瀏覽器沒重啟 |
| 「spawn failed: ENOENT」 | CLI 找不到，設 `AIYU_CLAUDE_PATH` 或 `AIYU_CODEX_PATH` |
| 「找不到 JSON 陣列輸出」 | CLI 回傳格式跑掉，看 `~/Library/Application Support/aiyu/aiyu-host.log` 檢查實際輸出 |
| 改了 host 卻沒生效 | host 不會自動同步，要跑 `./host/deploy.sh` 重新部署再重載擴充套件 |
| YouTube 字幕沒翻 | 確認 YT 字幕已開啟、頁面 reload 一次（SPA 路由切換有偵測但偶爾漏） |

---

## 檔案結構

```
aiyu/
├── extension/
│   ├── manifest.json
│   ├── sw.js                  # service worker — 路由 / cache
│   ├── content/
│   │   ├── search-box.js      # 共用搜尋列（逐字稿面板／選取視窗共用）
│   │   ├── article.js         # 選取文字翻譯的浮動視窗 UI
│   │   ├── article.css
│   │   └── youtube.js         # YT 字幕 overlay + 逐字稿面板 + SRT 匯出
│   ├── popup/                 # 工具列 popup
│   ├── options/               # 詞庫與進階設定
│   └── icons/
└── host/
    ├── aiyu-host.js           # native messaging host
    ├── aiyu-host.sh           # wrapper：補 PATH 後 exec node host
    ├── com.lancetw.aiyu.json.template
    ├── install.sh             # 首次安裝（複製 host + 寫 native messaging manifest）
    └── deploy.sh              # 改完 host 後重新部署（只複製 host，不動 manifest）
```

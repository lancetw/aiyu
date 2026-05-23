<p align="center">
  <img src="docs/brand/aiyu-logo.png" alt="aiyu 愛玉" width="140" />
</p>

# aiyu — AI 譯語

一個專注於 **YouTube 字幕翻譯** 的 Chrome 擴充套件，呼叫本機的 `claude`、`codex` 或 `agy`（Antigravity）CLI，把字幕翻成 **台灣正體中文**（也可翻譯網頁上選取的文字）。

> **狀態**：0.3.0
> **平台**：macOS / Linux；Windows 實驗中（安裝器與 host 已跨平台，待 Windows 實測）
> **瀏覽器**：Chrome / Chromium / Edge / Brave / Arc

![aiyu 在 YouTube 上的雙語字幕 overlay、右側中英對照逐字稿面板，與左側選取翻譯浮動視窗](docs/images/youtube-bilingual.png)

> 上圖：YouTube 影片同時顯示播放器上的雙語字幕、右側可跟隨高亮的中英對照逐字稿面板，與左側選取文字的翻譯浮動視窗。

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
- **詞庫**（預設停用，須在進階設定勾選「啟用台灣詞庫」）注入 system prompt，不做後處理替換 — 模型會理解上下文，避免「程序員→程式員」這類災難。

---

## 安裝

### 1. 取得程式碼

`git clone` 本專案，或下載 release zip 解壓到一個**固定位置**（之後別刪／別移動 —— 擴充以
「載入未封裝」從這個資料夾執行）。需要本機有 `node`（裝過 `claude`／`codex` 多半已具備）。

### 2. 安裝 native host（跨平台：macOS / Linux / Windows）

```bash
node host/install.js
```

會自動：把 host 複製到穩定位置、產生 launcher（用當下 node 的絕對路徑啟動，不靠 shebang）、
註冊 native messaging（mac/linux 寫各瀏覽器 `NativeMessagingHosts/` 目錄；Windows 寫
`HKCU\…\NativeMessagingHosts` 登錄檔），最後印出載入擴充的步驟。偵測到的
Chrome / Chrome Canary / Chromium / Edge / Brave / Arc 都會註冊。

- `node host/install.js --dry-run`：只印出會做什麼，不實際寫入。
- `node host/install.js --uninstall`：移除 host 註冊。

### 3. 載入擴充（off-store / 載入未封裝）

依 `install.js` 印出的步驟：

1. 開啟 `chrome://extensions`
2. 開啟 **「開發人員模式」**（請**保持開啟**，否則 Chrome 會停用未封裝擴充）
3. 點 **「載入未封裝項目」**，選 `extension/` 資料夾
4. 載入後顯示的 Extension ID 應為 `loelfpeedlfjbjekifhjbbgejajnnpan`（固定值，已烤進 host 的
   `allowed_origins`，**不用手動複製貼上**）

### 4. 確認 CLI 可用

aiyu 預期下列任一執行檔已可呼叫：

- `codex`（OpenAI Codex CLI，預設）
- `claude`（Anthropic Claude Code CLI）
- `agy`（Google Antigravity CLI；以 `agy -p` 呼叫。模型由帳號端自動路由，無法在 aiyu 指定）

找不到時可設定環境變數（mac/linux 寫 shell profile；Windows 用系統環境變數）：

```bash
export AIYU_CLAUDE_PATH=/your/path/to/claude
export AIYU_CODEX_PATH=/your/path/to/codex
export AIYU_AGY_PATH=/your/path/to/agy
```

> Windows 提醒：`claude`／`codex` 多半是 npm 裝的 `.cmd`；host 已會自動找 `%APPDATA%\npm` 等位置與 `.cmd`/`.exe` 副檔名。

### 5. 重啟瀏覽器

關掉所有 Chrome 視窗再開（讓 Native Messaging 重新註冊）。

### 6. 測試

點擴充套件圖示 → 「測試 host 連線」。應顯示「連線成功：aiyu-host」。

> **修改後如何生效（重要）**
>
> 前端與 host 的更新方式**不對稱**：
> - **前端**（`extension/`：`youtube.js`、`sw.js`、`manifest.json`…）：`chrome://extensions` 重新載入 + **重整該分頁**即生效（content script 在頁面載入時注入，舊分頁不會自動更新）。
> - **host**（`host/aiyu-host.js`）：**不會自動同步**到瀏覽器實際啟動的位置。改完必須重新部署：`node host/install.js`，再到 `chrome://extensions` 重新載入 aiyu（讓常駐的舊 host 行程退場、下次翻譯啟動新碼）。

---

## 使用

- **YouTube**：開啟有字幕的影片，點播放列上的aiyu 按鈕；譯文會以雙語字幕疊在播放器上（字幕框可拖曳、滾輪縮放字級）。右上角徽章顯示進度／狀態（首批翻好前顯示「連接 ⟨模型⟩ 模型中…」，含「翻譯額度用盡」）。把游標移到aiyu 按鈕會展開選單：**開啟雙語對照字幕**（可拖曳縮放的逐字稿面板，自動跟隨高亮、點句跳轉、可搜尋；標題列顯示翻譯所用模型）、**下載雙語對照 SRT**，與**重新翻譯（⟨目前模型⟩）**（清掉舊譯文、套用目前模型重翻整支；切換模型後用它取得新模型譯文）。
- **選取文字**：在任意網頁選取一段文字 → 右鍵「aiyu：翻譯選取文字」→ 譯文顯示在浮動視窗（可拖曳、縮放、調整字級、切換譯上原下／左右並排、關鍵字搜尋）。
- **設定**：點圖示開啟 popup（後端 CLI、模型、目標語言、風格）；點「進階設定」可勾選啟用台灣詞庫（預設停用）、編輯詞庫與自訂提示詞。

---

## 設定項

| 設定 | 預設 | 說明 |
|---|---|---|
| `cli` | `codex` | 使用 `codex exec`、`claude -p` 或 `agy -p`（Antigravity 無模型可選） |
| `model` | codex=`gpt-5.5`、claude=`Opus 4.7` | 各後端使用的模型（預設為最強）；claude 可選 Haiku 4.5 / Sonnet 4.6 / Opus 4.7 / Opus 4.6，UI 標示版本；Antigravity 由帳號端自動路由，無此選項 |
| `target` | `zh-TW` | 目標語言（繁中台灣 / 簡中 / 英 / 日） |
| `style` | `natural` | natural / literal / academic |
| `glossaryEnabled` | `false`（停用） | 是否套用台灣詞庫；須在進階設定勾選「啟用台灣詞庫」並儲存 |
| `glossary` | 內建約 200 條 | 對岸詞 → 台灣詞對照（注入 system prompt，啟用後才生效） |
| `customPrompt` | 空 | 額外 system prompt 追加 |

---

## 已知限制 / 不做的事

- 不做 PDF 翻譯
- 不做整篇網頁文章逐段翻譯（僅支援「選取文字」翻譯）
- 不做語音辨識（YouTube 沒有字幕的影片就跳過）
- 每次 CLI spawn 約 1–3 秒，首段翻譯會明顯停頓；後續段落因 cache + 並行較快
- Native host 不能透過 Chrome Web Store 散布，使用者必須手動跑 `node host/install.js`

---

## 除錯

- Native host 的 stderr 與動作 log 寫到：`~/Library/Application Support/aiyu/aiyu-host.log`（可用 `AIYU_LOG` 覆寫）
- Service worker log：`chrome://extensions` → 點此擴充套件的「Service worker」開 DevTools
- Content script log：頁面右鍵 → 檢查 → Console

常見問題：

| 症狀 | 原因 |
|---|---|
| popup 顯示「連線失敗：Specified native messaging host not found.」 | `node host/install.js` 沒成功註冊，或瀏覽器沒重啟 |
| 「spawn failed: ENOENT」 | CLI 找不到，設 `AIYU_CLAUDE_PATH` 或 `AIYU_CODEX_PATH` |
| 「找不到 JSON 陣列輸出」 | CLI 回傳格式跑掉，看 `~/Library/Application Support/aiyu/aiyu-host.log` 檢查實際輸出 |
| 改了 host 卻沒生效 | host 不會自動同步，要跑 `node host/install.js` 重新部署再重載擴充套件 |
| YouTube 字幕沒翻 | 確認 YT 字幕已開啟、頁面 reload 一次（SPA 路由切換有偵測但偶爾漏） |

---

## 檔案結構

```
aiyu/
├── extension/
│   ├── manifest.json
│   ├── sw.js                  # service worker — 路由 / cache
│   ├── content/
│   │   ├── yt-key-shim.js     # YT「C」鍵攔截（world:MAIN、document_start，搶在 YT 前）
│   │   ├── search-box.js      # 共用搜尋列（逐字稿面板／選取視窗共用）
│   │   ├── article.js         # 選取文字翻譯的浮動視窗 UI
│   │   ├── article.css
│   │   └── youtube.js         # YT 字幕 overlay + 逐字稿面板 + SRT 匯出
│   ├── shared/
│   │   └── models.js          # 模型清單／預設（單一來源；sw / popup / options 共用）
│   ├── popup/                 # 工具列 popup
│   ├── options/               # 詞庫與進階設定
│   └── icons/
└── host/
    ├── aiyu-host.js           # native messaging host（跨平台 CLI 偵測）
    ├── install.js             # ★ 跨平台安裝器（host 註冊 + 印出載入擴充步驟）
    ├── diag.sh                # 純診斷：證明瀏覽器能否 exec binary（不走 native messaging）
    ├── smoke.js               # 煙霧測試：模擬 Chrome 送 ping + 一段 translate
    ├── smoke-concurrent.js    # 煙霧測試：同時 3 筆 translate，驗 id 不混淆
    └── smoke-model.js         # 煙霧測試：驗 model 參數有帶到 CLI
```

---

## 授權

[MIT](LICENSE) © 2026 lancetw

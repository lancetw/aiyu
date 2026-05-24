# aiyu 隱私權政策 / Privacy Policy

> 生效日期 / Effective date: 2026-05-24
> 最後更新 / Last updated: 2026-05-24

---

## 繁體中文

### 一句話總結

**aiyu 沒有開發者伺服器，但你的文字會送到你選的 AI 供應商雲端。** 翻譯時，你的文字會交給「**你自己安裝並登入**」的 AI 工具（`claude` / `codex` / `agy`），由它在**你自己的帳號**下，把文字傳到對應供應商的雲端（Anthropic／OpenAI／Google）產生譯文。重點是：**文字只去你選定的那家 AI 供應商，永遠不會經過 aiyu 開發者**——開發者不經營任何後端，也不收集你的資料、不做分析或追蹤。

### aiyu 是什麼、怎麼運作

aiyu 是一個瀏覽器擴充套件，用你本機已安裝的 AI 命令列工具翻譯 **YouTube 字幕**與**你選取的網頁文字**。資料路徑：

```
擴充套件 → 本機 native host（你的電腦上）→ 你安裝的 CLI（claude/codex/agy）→ 該 AI 供應商
```

native host 與 CLI 都跑在**你自己的電腦上**；只有最後一步（CLI 呼叫 AI）會離開你的電腦，且是在**你自己的帳號／訂閱**下進行。

### aiyu 會處理哪些資料

- **你要翻譯的文字**，僅限：
  1. 你**選取**文字後、按右鍵「aiyu：翻譯選取文字」時的那段文字；
  2. 你在某支 YouTube 影片上**啟動翻譯**時，該影片的字幕軌（由擴充向 YouTube 讀取）。
- **你的設定**：使用的 CLI、模型、目標語言、翻譯風格，以及（若你自行設定的）台灣詞庫與自訂提示詞。

aiyu **不會**在你未主動觸發時讀取頁面內容，也不收集瀏覽紀錄、個人身分資訊或頁面上其他文字。

### 資料流向

- 你要翻譯的文字，透過 Chrome native messaging 送到你電腦上的 native host。host 啟動你本機安裝的 AI CLI 並把文字交給它；CLI 在**你自己的帳號**下，把文字送往對應供應商的伺服器以產生譯文：
  - `claude` → Anthropic
  - `codex` → OpenAI
  - `agy`（Antigravity）→ Google
- 譯文沿原路徑返回擴充並顯示。

### 儲存與保留

- **設定**存在 `chrome.storage.sync`。若你開啟 Chrome 同步，這些設定會透過**你自己的 Google 帳號**在你的裝置間漫遊。其中只有你的偏好設定（與你自訂的詞庫／提示詞），**不含**被翻譯的內容。
- **翻譯快取**存在擴充 service worker 的**記憶體**中，用來避免對相同文字重複呼叫 CLI；屬暫存性質，service worker 卸載或你清除快取時即消失。
- **本機 host log**：native host 會在你的電腦上寫一個 log 檔（macOS 預設 `~/Library/Application Support/aiyu/aiyu-host.log`；Windows／Linux 位置不同）。內容為**操作性中繼資料**——時間、模型名稱、prompt 長度、耗時與錯誤訊息；**正常情況下不含你的原文或譯文**，但在錯誤情況下（輸入格式異常、或 CLI 回報錯誤），可能出現一小段（最多約 500 字元）被截斷的輸入片段或 CLI 錯誤輸出。此檔**只留在你的電腦、aiyu 不會傳送它**；它會持續累積、不會自動輪替或自動刪除，你可隨時手動刪除。**想完全關閉檔案紀錄**：把環境變數 `AIYU_LOG` 設為空裝置（macOS／Linux：`/dev/null`；Windows：`NUL`）即可停止寫檔。

### 第三方

- 唯一會收到你文字的第三方，是**你自己安裝並登入**的 AI 供應商（Anthropic／OpenAI／Google）。他們如何處理你的資料，依該供應商在**你帳號下**的條款與隱私權政策而定，aiyu 無法控制或更動。
- **YouTube**：為翻譯字幕，擴充會在你已開啟的 YouTube 頁面讀取該影片的字幕軌。這是在你既有的 YouTube 工作階段內讀取 YouTube 自己的資料，aiyu 不會為此額外送出任何資料。

### aiyu 不做的事

- **沒有 aiyu 伺服器**：開發者不經營任何後端，你的文字不會經過開發者。
- 不做分析、遙測、追蹤或廣告。
- 不販售、不分享你的資料給任何人（AI 供應商收到文字，純粹是因為你選它當翻譯引擎、且在你自己的帳號下）。

### 權限說明

- `nativeMessaging`：與啟動你 AI CLI 的本機 host 溝通（這是 Chrome 讓擴充和你電腦上已安裝程式通訊的機制）。
- `activeTab` + `scripting`：**只在你觸發翻譯時**，把翻譯介面注入當前分頁。
- `contextMenus`：提供右鍵「翻譯選取文字」選單。
- `storage`：儲存你的設定。
- youtube.com 存取：在 YouTube 疊加雙語字幕。

### 你的控制權

- 自由選擇要用哪個 CLI／供應商（或都不用）。
- 隨時在擴充清除翻譯快取。
- 解除安裝：在 Chrome 移除擴充；依專案 README 指示移除本機 host（目前為 `node host/install.js --uninstall`）；如有需要可自行刪除本機 log 檔。

### 兒童

aiyu 非針對 13 歲以下兒童設計，也不會向其收集資料。

### 政策變更

本政策若有變更，會更新本文件與上方「最後更新」日期；重大變更會於文件中註明。

### 聯絡方式

問題或疑慮請開 GitHub issue：<https://github.com/lancetw/aiyu/issues>

---

## English

### In one sentence

**aiyu has no developer server — but your text does go to the AI provider you chose.** When you translate, your text is handed to the AI tool **you yourself installed and signed into** (`claude` / `codex` / `agy`), which sends it — under **your own account** — to that provider's cloud (Anthropic / OpenAI / Google) to produce the translation. The key point: **your text goes only to the AI provider you picked, and never passes through the aiyu developer** — the developer runs no backend and collects no data, analytics, or tracking.

### What aiyu is and how it works

aiyu is a browser extension that translates **YouTube subtitles** and **text you select on web pages** using an AI command-line tool already installed on your own machine. The data path is:

```
Extension → local native host (on your computer) → your installed CLI (claude/codex/agy) → that AI provider
```

The native host and the CLI both run **on your own computer**; only the final step (the CLI calling the AI) leaves your machine, and it does so under **your own account/subscription**.

### What data aiyu handles

- **The text you ask it to translate**, limited to:
  1. the text you **select** and then translate via the right-click "aiyu: Translate selection" menu;
  2. the caption track of a YouTube video when you **start translation** on that video (read from YouTube by the extension).
- **Your settings**: which CLI, model, target language, and style you chose, plus your Taiwan glossary and custom prompt if you configured them.

aiyu does **not** read page content unless you actively trigger it, and does not collect browsing history, personal identifiers, or other text on the page.

### Where data goes

- The text to translate is sent via Chrome native messaging to the native host on your computer. The host launches your locally-installed AI CLI and passes it the text; under **your own account**, the CLI sends the text to that provider's servers to produce the translation:
  - `claude` → Anthropic
  - `codex` → OpenAI
  - `agy` (Antigravity) → Google
- The translation returns along the same path to the extension and is displayed.

### Storage and retention

- **Settings** are stored in `chrome.storage.sync`. If you have Chrome Sync enabled, they roam across your devices via **your own Google account**. This contains only your preferences (and your custom glossary/prompt if set) — **not** the translated content.
- **Translation cache** lives in the extension service worker's **memory** to avoid re-invoking the CLI for identical text; it is ephemeral and cleared when the service worker unloads or when you clear the cache.
- **Local host log**: the native host writes a log file on your computer (macOS default `~/Library/Application Support/aiyu/aiyu-host.log`; different on Windows/Linux). It contains **operational metadata** — timestamps, model name, prompt length, timing, and error messages — and **normally contains none of your source text or translations**. Under error conditions (malformed input, or a CLI-reported error), a truncated fragment (up to about 500 characters) of the input or the CLI's error output may appear in it. **This file stays on your computer and aiyu never transmits it**; it accumulates over time with no automatic rotation or deletion, and you may delete it at any time. **To turn off file logging entirely**, set the `AIYU_LOG` environment variable to a null device (`/dev/null` on macOS/Linux, `NUL` on Windows).

### Third parties

- The only third parties that receive your text are the AI provider(s) **you installed and authenticated** (Anthropic / OpenAI / Google). Their handling of your data is governed by that provider's own terms and privacy policy under **your account**; aiyu does not control or alter it.
- **YouTube**: to translate subtitles, the extension reads the current video's caption track from the YouTube page you are already on. This reads YouTube's own data within your existing session; aiyu sends nothing extra for this.

### What aiyu does NOT do

- **No aiyu server**: the developer operates no backend; your text never reaches the developer.
- No analytics, telemetry, tracking, or advertising.
- Does not sell or share your data with anyone (the AI provider receives it only because you chose it as your translation engine, under your own account).

### Permissions

- `nativeMessaging`: communicate with the local host that runs your AI CLI (a Chrome API that lets an extension talk to a program installed on your computer).
- `activeTab` + `scripting`: inject the translation UI into the current tab **only when you trigger a translation**.
- `contextMenus`: the right-click "translate selection" menu.
- `storage`: save your settings.
- youtube.com host access: overlay bilingual subtitles on YouTube.

### Your controls

- Choose which CLI/provider to use (or none).
- Clear the translation cache from the extension at any time.
- Uninstall: remove the extension in Chrome; remove the native host per the project README (currently `node host/install.js --uninstall`); delete the local log file if you wish.

### Children

aiyu is not directed at children under 13 and collects no data from them.

### Changes to this policy

If this policy changes, this document and the "Last updated" date above will be updated; material changes will be noted in the document.

### Contact

For questions or concerns, please open a GitHub issue: <https://github.com/lancetw/aiyu/issues>

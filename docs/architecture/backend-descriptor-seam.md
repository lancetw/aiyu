# 設計文件：後端 descriptor seam（backend-descriptor-seam）

> improve-loop pass 5 產出。Class B：介面形狀需人為決策，loop 不自動實作。
> 注意：docs/ 是 GitHub Pages 發佈根目錄——本檔合併後會被公開服務（repo 本身已公開，屬可接受）。

## 摩擦（用 deep-module 詞彙）

「有哪些後端、每個後端怎麼跑」這條知識沒有單一 module 擁有，而是**洩漏（leak）**到
`host/aiyu-host.js` 的四個位置，彼此靠人工同步：

| 位置 | 形式 |
|---|---|
| `detectAvailability` | 物件字面值 `{ claude, codex, agy }`（逐鍵 `findExecutable`） |
| `pickCli` | 陣列字面值 `["claude", "codex", "agy"]`（fallback 順序） |
| `runCli` | 三臂 `if (cli === "claude") … else if ("codex") … else if ("agy")`（bin、args、outFile 策略） |
| `runCli` Windows 分支 | 又一組 per-cli `if/else`（stdin payload 拔哪個 arg） |

另外 `buildPrompt` 的**介面（interface）**回傳 `{system, user}` 拆式，但 codex/agy 兩個
消費者必須自行再合併（`` `${system}\n\n${user}` `` 出現兩次）——「prompt 對每個後端長什麼樣」
這個決策被切在 `buildPrompt` 與 `runCli` 兩個 implementation 之間，是典型的淺 seam：
呼叫端被迫知道實作細節。

實際成本：新增/移除一個 CLI 後端（歷史上發生過：agy 是第三個，Chrome 內建模型是被放棄的
第四個嘗試，見 memory `aiyu-chrome-builtin-model`）需要同步改 4-5 個位置，漏一處即靜默壞掉
（如：偵測得到但 runCli 不認識 → `unknown cli` 錯誤）。

## 設計分岔（forks）

**Fork 1 — descriptor 的形狀：**
- (a) 資料表：`BACKENDS = { claude: { bin: "claude", buildArgs(prompt, model, context), mergesPrompt, usesOutFile, stdinArgIndex }, … }`
  — `detectAvailability`/`pickCli`/`runCli` 全部改為迭代此表。
- (b) 函式表：每後端一個 `run(prompt, model, context) → {bin, args, outFile, stdinPayload}` 純函式，共用邏輯留在 runCli。
- (c) 維持現狀＋只補不變量測試（最小改動；不解決 4 處同步，但把「漏改」變成紅燈）。

**Fork 2 — prompt 合併的歸屬：**
- (a) descriptor 帶 `mergesPrompt: boolean`，合併動作歸 runCli 一處（單一 `merged` const）。
- (b) `buildPrompt` 直接依 cli 回傳最終形狀（合併移進 buildPrompt）——但這讓 buildPrompt 對後端知識產生依賴，方向存疑。

**Fork 3 — fallback 順序的擁有者：**
`pickCli` 的順序=產品決策（claude 優先）。descriptor 表的 key 順序足以編碼？還是需要顯式
`FALLBACK_ORDER` 陣列？（JS 物件 key 順序可靠但隱晦。）

**牽動面：** quota/fallback 行為有既有使用者可感知語意（`meta.fellBack` → sw.js 會改寫使用者
偏好設定），descriptor 化不得改變此語意；`isQuotaError` 的樣式是跨後端共用的，不宜進表。

## 建議的深化（recommendation）

Fork 1(a) ＋ Fork 2(a) ＋ Fork 3 顯式 `FALLBACK_ORDER`：
一張 `BACKENDS` 表當**深模組**：介面窄（表＋兩個工具函式），實作深（吃掉四處 if/else）。
`detectAvailability` 變成 `Object.fromEntries(Object.keys(BACKENDS).map(...))`，
`pickCli` 迭代 `FALLBACK_ORDER`，`runCli` 查表拿 `bin`/`buildArgs`。
Windows stdin 分支以 descriptor 的 `promptArgIndex`（或 `popPromptToStdin: true`）統一。

**前置條件（同樣是 B 級決策）：** aiyu-host.js 目前無 node 測試 seam（載入即執行
`log("aiyu-host started")` 與 stdin 迴圈）。descriptor 化之前應先決定 test seam 形狀
（守衛頂層副作用 + `module.exports = { BACKENDS, pickCli, … }`），否則重構無紅綠可依。
建議兩步走：(1) 加 seam＋為現行三臂行為寫特徵測試（characterization tests）；(2) 再 descriptor 化。

## 驗收判準

- 新增第四個後端＝只加一個表項＋（如有）一個 smoke script。
- `runCli` 內不再出現 `cli === "..."` 字面比較。
- 既有語意不變：fallback 順序、meta.fellBack、quota 訊息、Windows stdin 路徑。
- 特徵測試在重構前後皆 green。

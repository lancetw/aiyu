# 設計文件：quota 錯誤的結構化契約（quota-error-contract）

> improve-loop pass 9 產出。Class B：wire format 決策、橫跨兩個無測試 seam 的檔案，loop 不自動實作。
> 注意：docs/ 是 GitHub Pages 發佈根目錄——本檔合併後會被公開服務（repo 已公開，屬可接受）。

## 摩擦（用 deep-module 詞彙）

「額度用盡」這個**在地化字串**同時扮演兩個角色，而兩個角色的變更壓力方向相反：

1. **使用者文案**：article.js（選取翻譯路徑）把 host 錯誤原樣顯示（`"翻譯失敗：" + err`）；
   youtube.js 的 badge 另外手抄一份「⚠ 翻譯額度用盡，請稍後再試」。
2. **機器契約**：youtube.js 以 `err.includes("額度用盡")` 判定 quota、觸發「額度早停」
   （quotaHit → 中止整輪、badge 常駐不淡出、未譯 cue 保持 null 不鎖死成原文）。

字串的誕生點在 host（`runCli` 兩處：逾時但 stderr 含額度字樣、以及非零退出且
`isQuotaError(stderr)`），host 端註解明白承認這是「乾淨、可辨識的關鍵字」——
也就是說**契約存在，但只存在於註解與字面值的默契中**：

```
host  aiyu-host.js  reject(new Error(`翻譯額度用盡，請稍後再試（${cli}）`))  ×2
  ↓   writeMessage({ id, error: e.message })          ← 非結構化，字串就是全部
sw    sw.js         cb.reject(new Error(msg.error))    ← 原樣轉發
  ↓
yt    youtube.js    err.includes("額度用盡") → quotaHit ← 對在地化文案做 substring 比對
art   article.js    原樣渲染給使用者                    ← 同一字串又是 UI
```

這是一條**洩漏的 seam**：wire format 沒有為「錯誤種類」留欄位，於是前端只能從
給人看的文字裡反推機器語意（adapter 缺席，locality 被打破——quota 語意的知識
散在 host 註解、youtube 比對式、badge 手抄文案三處）。改一次措辭（例如「配額已滿」）
＝quota 偵測靜默失效、退化成一般重試路徑，無任何測試會紅。

## 設計分岔（forks）

**Fork 1 — discriminator 放哪：**
- (a) 錯誤物件加欄位：`writeMessage({ id, error: e.message, reason: "quota" })`。
  wire 向後相容（舊前端忽略新欄位）；host 端把 reason 隨 Error 物件帶出
  （e.g. `err.reason = "quota"`，handleMessage 讀取）。
- (b) 錯誤碼字串：`error: "QUOTA_EXHAUSTED"`＋另一欄位帶人話文案。破壞相容
  （article.js 會把錯誤碼渲染給人看），需同步改三處。
- (c) 維持字串契約但抽共享常數：無法跨 host（node）/content script（瀏覽器）共享
  模組——此路不通，除非引入建置步驟（不值得）。

**Fork 2 — sw.js 轉發層要不要理解 reason：**
- (a) 透明轉發（`cb.reject` 的 Error 物件掛上 `reason`）——sw 保持薄 adapter。
- (b) sw 轉譯成自己的錯誤分類——過度設計，sw 目前對錯誤語意零依賴。

**Fork 3 — badge 文案歸屬：**
youtube.js:1346 手抄的「⚠ 翻譯額度用盡…」在結構化之後就只是 UI 文案，
可以繼續住在前端（推薦——文案本來就該在顯示層），也可以由 host 的 error
欄位帶出（讓 host 決定人話，前端只加 ⚠）。

**牽動面：**
- `isQuotaError(stderr)` 的偵測樣式（usage limit/quota/429…）不受影響，仍留 host。
- selection 路徑（article.js）行為完全不變：它只顯示 error 字串。
- 測試：sw.js 有 node seam——`mergeHostResults` 模式可比照，為「reason 透傳」加測試；
  youtube.js 端的 `quotaHit` 分支仍無 seam（另一個 B：content-script test seam）。

## 建議的深化（recommendation）

Fork 1(a) ＋ Fork 2(a) ＋ Fork 3 文案留前端：

1. host：兩個 quota reject 處改丟帶 `reason` 的錯誤（自訂 Error 子類或掛屬性），
   `handleMessage` 的 catch 寫 `writeMessage({ id, error: e.message, reason: e.reason })`
   （undefined 自然不序列化）。
2. sw.js：`port.onMessage` 把 `msg.reason` 掛回 reject 的 Error 上；translate 的
   sendResponse 錯誤路徑同樣帶出。此層有測試 seam，先寫 red test（fake port 回
   `{error, reason}` → 斷言前端拿得到 reason）再實作。
3. youtube.js：`err.includes("額度用盡")` 改為 `err.reason === "quota"`（保留
   includes 作為一版過渡的 fallback 亦可，讓新舊 host 混用時不退化）。
4. 字串自此只是文案；host 端註解「關鍵字」的約定刪除。

## 驗收判準

- 修改「額度用盡」文案（任意措辭）後，quota 早停行為不變。
- sw 層新測試：reason 欄位端到端透傳（fake port → translateBatch reject）。
- 舊 host＋新前端混用不炸（fallback 或版本註記擇一）。
- article.js 選取路徑輸出不變。

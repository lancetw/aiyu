# 設計文件：settings-schema seam（models.js 從「模型清單來源」升格為「設定 schema 來源」）

> improve-loop pass 10 產出。Class B：介面設計橫跨三個消費者、頁面腳本無測試 seam，loop 不自動實作。
> 本文件是一個「病根」文件：吸收 backlog 中四個同源候選 —— centralize-settings-defaults、
> dedup-model-picker-wiring、dedup-resolveModel-inline-ternary、model-key-convention-leak。
> 注意：docs/ 是 GitHub Pages 發佈根目錄——合併後會被公開服務（repo 已公開，屬可接受）。

## 摩擦（用 deep-module 詞彙）

`shared/models.js` 的檔頭自述是「模型設定的單一來源」，其存在理由（charter）正是
「避免清單／預設值各自複製而漏改」。但它只做到模型清單這一層；**設定 schema 的其餘
知識全部洩漏回三個消費者**，各自手抄：

| 洩漏的知識 | 重複位置（皆已逐行驗證） |
|---|---|
| storage 預設值（cli/target/style/customPrompt/glossary…） | sw.js getSettings、popup.js loadSettings、options.js load —— 三份字面值 |
| 「目前 cli 用哪個模型」讀取邏輯 | `cli === "codex" ? d.codexModel : d.claudeModel` 內聯 5 處（popup ×3、options ×2），而 `AIYU.resolveModel` 就是這個函式 |
| 「模型存進哪個 key」寫入慣例 | `cli === "codex" ? "codexModel" : "claudeModel"` 內聯 2 處（popup、options）——seam 只蓋讀取端，寫入端裸奔 |
| cli/model 選單 ↔ storage 的佈線 | popup 與 options 各 ~15 行近乎相同的 change-handler 序列 |

結果：models.js 是一個**淺 seam**——介面寬度（清單＋工具函式）遠小於消費者
實際需要的知識面（schema、預設、讀寫慣例、佈線），差額由每個消費者自行補齊，
每次補齊就是一份會漂移的副本。新增一個 CLI 後端要動 popup、options、sw 三處
＋host（後者見 backend-descriptor-seam 文件——兩份文件合起來才是「加後端」的完整成本）。

**額外的語意陷阱（為何這不是機械改動）：** 內聯讀取式與 `resolveModel` 對 `cli="agy"`
語意不同——內聯回 claudeModel、resolveModel 回 null。現行等價僅因 `fillModelOptions("agy",…)`
會隱藏整列並忽略 selected 參數。任何 dedup 都必須先固定這個邊界行為。

## 設計分岔（forks）

**Fork 1 — schema 物件的形狀：**
- (a) `AIYU.DEFAULT_SETTINGS`（一份完整物件，消費者 spread 全量）——最簡；代價：
  popup 拿到它不需要的 glossary 預設（`storage.get` 多要無害，但語意上略寬）。
- (b) 按消費者切子集（`DEFAULT_SETTINGS.page` / `.sw`）——精準；代價：切分本身是新知識。
- (c) schema 條目化（key → {default, scope}）——最完整；對這個 5-key 的小 schema 是過度設計。

**Fork 2 — 寫入端 key 慣例：**
- (a) `AIYU.modelKey(cli)` 小函式，與 resolveModel 對稱（讀寫同 seam）。
- (b) 乾脆改 storage 形狀為 `models: {codex: "...", claude: "..."}` 單一 key——
  消滅慣例本身，但需遷移既有使用者資料（schema 從未演化過，這會是第一次；
  成本不小，收益有限）。

**Fork 3 — 佈線 helper 的介面：**
- (a) `AIYU.wireModelPicker({cliSel, modelSel, onSaved})` 收元素引用——DOM 知識留頁面。
- (b) 收元素 id 字串——更短，但把「頁面長怎樣」的知識拉進 models.js。
- (c) 不抽佈線，只抽 schema（接受兩頁各留 15 行）——若認定兩頁 UI 未來會分化，這是合理停損點。

**牽動面：** 頁面腳本（popup/options）無 node seam——models.js 這端的新函式
（DEFAULT_SETTINGS/modelKey）可以用既有 require seam 先行 TDD；佈線 helper 需要 DOM，
只能靠人工驗證或未來的 jsdom 決策。sw.js 的 getSettings 有測試（sw-get-settings.test.js），
改 spread DEFAULT_SETTINGS 時該測試就是現成的紅綠依據。

## 建議的深化（recommendation）

Fork 1(a) ＋ Fork 2(a) ＋ Fork 3(a)，分三步、每步獨立可收：

1. **DEFAULT_SETTINGS 進 models.js**（含 glossary 預設的組裝），sw.js 先接
   （有測試，紅綠可走），popup/options 跟進 spread。三份字面值 → 一份。
2. **modelKey(cli) 進 models.js**，讀寫對稱；同步把 5 處內聯 ternary 改
   `resolveModel`——此時必須寫下 agy 邊界的 characterization（models.js 有 require
   seam，可直接 TDD：`resolveModel({cli:"agy",…}) === null` 與 fillModelOptions
   隱藏行為的說明性測試）。
3. **wireModelPicker** 最後做（或依 Fork 3(c) 停損）——它依賴前兩步的 schema 工具。

## 驗收判準

- `cli:"codex"`、`target:"zh-TW"` 等預設字面值全 repo 各僅出現一次（models.js）。
- popup/options 不再出現 `codexModel" : "claudeModel` 任何形式的 ternary。
- 新增一個 CLI 後端在 extension 端＝改 models.js 一檔（清單＋預設）；配合
  backend-descriptor-seam 後，全專案＝models.js＋host BACKENDS 表各一處。
- sw-get-settings 既有測試不改斷言即 green（預設值行為不變）。

# Coding standards

審查 diff 時套用的規則。能用檢查抓到的一律放進 `npm test`，不寫在這裡。

## 擴充與 host 的版本落差

擴充從 Chrome Web Store 自動更新；本機 host（`npx @lancetw/aiyu`）只有使用者重跑安裝程式才會更新。新擴充搭配上一版 host 的狀態會持續好幾週。

- 改動擴充送給 host 的內容（`extension/sw.js` 的 `callHost` payload），或 host 組 CLI 參數的方式（`host/aiyu-host.js` 的 `runCli`），必須仍能搭配上一個 minor 版的 host 運作：舊 host 不認得的欄位，要退回舊行為，不能變成 CLI 呼叫失敗。
- 舊 host 無法正確運作時，發版要升 minor 版號，讓 popup 的 `hostOutdated` 提示出現，release note 也要提醒使用者重跑 `npx @lancetw/aiyu`。
- 新增 host 端需求卻兩者都沒做的 diff，要標出來。

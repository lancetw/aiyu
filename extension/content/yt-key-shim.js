// aiyu — YouTube C 鍵攔截 shim（world:MAIN、run_at:document_start）
//
// 為什麼需要這支：YouTube 的鍵盤快捷處理器掛在 window 上、且在頁面 app 程式很早就註冊。
// content script（isolated world、document_idle）即使用 capture 也搶不到 C 的 keydown ——
// YT 先吃掉並 stopImmediatePropagation，我們的 listener 根本不會被呼叫（按鈕點擊則因為
// 我們的 window-capture 比按鈕自身 handler 早觸發，所以搶得到、照常有效）。
//
// 解法：宣告一支 world:MAIN + document_start 的 content script。它在 YT 的「同一個世界」、
// 且比 YT 的 app 程式更早註冊 window capture keydown → 排在 YT 前面，搶得到 C，攔下後
// stopImmediatePropagation 擋掉 YT 原生字幕切換（連帶不跳「字幕 開/關」提示）。
//
// 但 main world 讀不到 youtube.js（isolated world）的狀態，故：
//   * 是否啟動：由 youtube.js 寫在 <html data-aiyu-active="1">（DOM 跨世界共用）判斷。
//   * 切換動作：本 shim 只負責攔 C，再 dispatch 自訂事件；真正切換字幕框交給 youtube.js
//     的事件 listener（自訂事件在 window 上 dispatch，兩個世界的 listener 都收得到）。
(() => {
  if (window.__aiyuKeyShim) return;
  window.__aiyuKeyShim = true;

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key || "").toLowerCase() !== "c") return;
      // aiyu 未啟動 → 完全不接管，C 維持 YouTube 原生切換字幕
      if (document.documentElement.dataset.aiyuActive !== "1") return;
      // 焦點在輸入框／可編輯區（含我們的搜尋列、YT 搜尋框）時，C 照常輸入
      const t = e.target;
      const tag = t && t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (t && t.isContentEditable)) return;
      // 攔下 C：擋掉 YT 原生切換，改通知 youtube.js 切換我們的字幕框
      e.preventDefault();
      e.stopImmediatePropagation();
      window.dispatchEvent(new Event("aiyu-toggle-captions"));
    },
    true
  );
})();

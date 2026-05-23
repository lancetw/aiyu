// aiyu YouTube caption translator — 預先翻譯 + 時間軸同步版
//
// 由 YouTube 播放列上注入的aiyu 按鈕啟動 / 關閉（按鈕一定在播放器建好後才出現，
// 因此點下去時 videoId 與播放器 DOM 都保證就緒）。
//
// 啟動流程：
//   1. 用 ANDROID InnerTube client 取得字幕軌清單（避開 WEB client 的 pot 限制）
//   2. 下載整條字幕軌（json3 timedtext），切成有時間碼的 cue
//   3. 立刻開始「跟隨 video.currentTime」顯示，未翻好的 cue 暫顯「翻譯中…」
//   4. 背景把所有 cue 分批送 CLI 翻譯，邊翻邊更新
//   啟動後隱藏 YouTube 原生字幕，只顯示我們的雙語字幕框。
//
// 為什麼預先翻譯而非即時翻譯：
//   CLI 翻一句要數秒，即時翻譯永遠落後畫面。預先翻好、純靠時間碼顯示，延遲為零。
(() => {
  if (window.__aiyuYTLoaded) return;
  window.__aiyuYTLoaded = true;
  // 載入標記：開 console 看到這行＝跑的是含「額度早停」的新碼；沒看到＝還是舊碼。
  console.log("[aiyu] youtube.js 已載入 — build: 額度早停 v0.1.1");

  const SYNC_MS = 200;
  // 預載緩衝：從開頭起「連續已翻好」的字幕要覆蓋到第幾秒，才從頭自動播放。
  // 設大 → 開播前等更久，但播放較不會追上翻譯前線(導致字幕落後 / 露原文)。
  const PREROLL_SEC = 180; // 3 分鐘

  let active = false;
  let videoId = "";
  let cues = [];          // [{start,end,dur,text,zh}]
  let curIdx = -1;
  // 使用者用原生字幕鈕 / C 鍵手動隱藏我們的字幕框（aiyu 啟動時才生效）。
  let userHidden = false;
  // 啟動後到「開頭起連續 PREROLL_SEC 秒的字幕都翻好」之間的等待期：影片暫停在 0、
  // 字幕框顯示等待提示。翻譯很慢（每次 CLI 呼叫約 6s）且要先備足緩衝，
  // 否則播放很快追上翻譯前線、字幕落後露原文。
  let waiting = false;
  // 「自動跳回開頭並從頭播放」只在每支影片的第一次翻譯做一次。
  // 記下已跳播過的 videoId — 同一支影片重新切換 aiyu → 原地翻譯不再拉回 0:00；
  // 換到別支影片 → 那支自己的第一次。模組層級 Set，SPA 換影片保留、整頁重載才清空。
  const jumpedVideoIds = new Set();
  let syncTimer = null;
  let doneFlashTimer = null;
  let badgeAnim = null;   // 右上角徽章 spinner 動畫的 interval
  let badgeSpin = 0;
  let badgeLabel = "";
  let translationDone = false; // 整支翻完才為 true → 子選單動作項才啟用
  let progressPct = 0;         // 翻譯進度 %，給子選單「翻譯中 X%」提示用
  let menu = null;          // 子選單根元素
  let menuOpenRow = null;   // 「開啟」列
  let menuDownRow = null;   // 「下載」列
  let menuRetransRow = null; // 「重新翻譯」列(套用目前模型重翻整支)
  let menuHint = null;      // 狀態提示行(未啟動/翻譯中)
  let menuHideTimer = null; // hover 離開後延遲收合計時器
  let transcriptPanel = null;  // 字幕面板根元素
  let transcriptList = null;   // 可捲動的行容器
  let transcriptRows = [];     // 各 cue 對應的行元素
  let transcriptBuiltFor = ""; // 已建行的 videoId(換片重建)
  let transcriptIdx = -1;      // 目前高亮的 cue index
  let autoScrolling = false;   // 程式化捲動中(用來區分使用者捲動)
  let lastUserScroll = 0;      // 上次使用者手動捲動的時間戳
  let transcriptSearch = null; // 字幕搜尋列(共用 search-box.js)
  let panelModelTag = null;    // 面板 header 顯示「用哪個模型翻譯」
  let lastModelLabel = "";     // 最近一次翻譯使用的模型標籤(面板開啟前先記著)

  let overlay = null;
  let box = null;
  let badge = null;
  let hideStyleEl = null; // 隱藏原生字幕用的 <style>

  // 位置以「中心點佔播放器寬高的百分比」儲存 — 全螢幕切換也不跑位
  let pos = loadJSON("aiyu-yt-pos", { cx: 50, cy: 86 });
  let fontPx = clampFont(Number(localStorage.getItem("aiyu-yt-font")) || 30);
  let boxSize = loadJSON("aiyu-yt-size", null); // {w,h} 字串，使用者縮放後才有

  // 拖曳狀態放模組層級：window 監聽只掛一次，避免重複掛載
  let dragging = false;
  let dragSX = 0, dragSY = 0, dragCX0 = 0, dragCY0 = 0;

  // 逐字稿面板：位置/大小以「視窗 px」儲存（一般模式 fixed、全螢幕 absolute 共用同一組座標）
  let trPos = loadJSON("aiyu-yt-tr-pos", null);   // {left,top}，使用者拖曳後才有
  let trSize = loadJSON("aiyu-yt-tr-size", null);  // {w,h} 字串，使用者縮放後才有
  let trDragging = false;
  let trDragSX = 0, trDragSY = 0, trDragL0 = 0, trDragT0 = 0;
  let trFsHooked = false; // fullscreenchange / resize 監聽只掛一次

  function loadJSON(k, dflt) {
    try {
      const v = JSON.parse(localStorage.getItem(k));
      return v && typeof v === "object" ? v : dflt;
    } catch {
      return dflt;
    }
  }
  function clampFont(n) {
    return Math.min(72, Math.max(16, n || 30));
  }

  // ---------- overlay / box / badge ----------

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "aiyu-yt-overlay";
    Object.assign(overlay.style, {
      position: "absolute",
      inset: "0",
      pointerEvents: "none", // 整層讓點擊穿透，只有字幕框自己可互動
      zIndex: "60"
    });
    return overlay;
  }

  function applyBoxPosition() {
    if (!box) return;
    box.style.left = pos.cx + "%";
    box.style.top = pos.cy + "%";
  }

  function applyBoxSize() {
    if (!box || !boxSize) return;
    if (boxSize.w) box.style.width = boxSize.w;
    if (boxSize.h) box.style.height = boxSize.h;
  }

  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.id = "aiyu-yt-box";
    Object.assign(box.style, {
      position: "absolute",
      transform: "translate(-50%, -50%)",
      boxSizing: "border-box",
      padding: "6px 14px",
      borderRadius: "6px",
      lineHeight: "1.45",
      fontFamily: "system-ui, -apple-system, 'Noto Sans TC', 'PingFang TC', sans-serif",
      fontWeight: "500",
      maxWidth: "96%",
      minWidth: "140px",
      minHeight: "40px",
      textAlign: "center",
      whiteSpace: "pre-wrap",
      boxShadow: "0 2px 10px rgba(0,0,0,0.65)",
      pointerEvents: "auto", // 可被滑鼠抓取（拖曳 / 滾輪縮放 / 右下角縮放）
      cursor: "grab",
      userSelect: "none",
      resize: "both",        // 右下角把手 — 可調整字幕框寬高
      overflow: "hidden",
      display: "none"
    });
    box.style.fontSize = fontPx + "px";
    applyBoxPosition();
    applyBoxSize();

    // 拖曳移動（右下角 ~20px 留給原生縮放把手，不在那裡啟動拖曳）
    box.addEventListener("mousedown", (e) => {
      const r = box.getBoundingClientRect();
      if (e.clientX > r.right - 20 && e.clientY > r.bottom - 20) return;
      dragging = true;
      dragSX = e.clientX;
      dragSY = e.clientY;
      dragCX0 = pos.cx;
      dragCY0 = pos.cy;
      box.style.cursor = "grabbing";
      e.preventDefault();
      e.stopPropagation();
    });
    // 滾輪縮放字級
    box.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        fontPx = clampFont(fontPx + (e.deltaY < 0 ? 2 : -2));
        box.style.fontSize = fontPx + "px";
        try { localStorage.setItem("aiyu-yt-font", String(fontPx)); } catch {}
      },
      { passive: false }
    );
    return box;
  }

  function ensureBadge() {
    if (badge) return badge;
    badge = document.createElement("div");
    badge.id = "aiyu-yt-badge";
    Object.assign(badge.style, {
      position: "absolute",
      top: "12px",
      right: "12px",          // 固定在播放器右上角 — 小、不擋畫面、不在正中央
      padding: "3px 10px",
      borderRadius: "999px",
      fontFamily: "system-ui, -apple-system, 'Noto Sans TC', sans-serif",
      fontSize: "12px",
      lineHeight: "1.5",
      pointerEvents: "none",
      whiteSpace: "nowrap",
      display: "none",
      opacity: "1",
      transition: "opacity 0.45s ease"
    });
    return badge;
  }

  // 把 overlay 掛回播放器（全螢幕切換 / SPA 換頁會把它丟掉）
  function attachOverlay() {
    const player = document.querySelector(".html5-video-player");
    if (!player) return false;
    if (getComputedStyle(player).position === "static") player.style.position = "relative";
    const o = ensureOverlay();
    if (o.parentElement !== player) player.appendChild(o);
    const b = ensureBox();
    if (b.parentElement !== o) o.appendChild(b);
    const bd = ensureBadge();
    if (bd.parentElement !== o) o.appendChild(bd);
    return true;
  }

  // 字幕框單行訊息：kind = "status"(等待提示) | "error" | "hidden"(空字串)
  function render(text, kind) {
    if (!attachOverlay()) return;
    const b = ensureBox();
    if (!text) {
      b.style.display = "none";
      b.textContent = "";
      return;
    }
    b.style.display = "inline-block";
    b.textContent = text;
    if (kind === "error") {
      b.style.background = "rgba(120,53,15,0.92)";
      b.style.color = "#fde68a";
    } else {
      b.style.background = "rgba(0,0,0,0.62)";
      b.style.color = "#d4d4d4";
    }
  }

  // 雙語字幕：譯文在上（醒目），原文在下（較小、灰色）作對照。
  // 譯文未到時上行先顯示「翻譯中…」，原文已可同步顯示，版面不會跳動。
  function renderCue(c) {
    if (!attachOverlay()) return;
    const b = ensureBox();
    b.style.display = "inline-block";
    b.style.background = "rgba(0,0,0,0.84)";
    b.style.color = "#fff";
    b.replaceChildren();

    const zhLine = document.createElement("div");
    zhLine.textContent = c.zh || "（翻譯中…）";
    b.appendChild(zhLine);

    // 原文已是中文、或與譯文相同 → 不重複顯示
    if (c.text && c.text !== c.zh) {
      const origLine = document.createElement("div");
      origLine.textContent = c.text;
      Object.assign(origLine.style, {
        fontSize: "0.7em",
        color: "#bdbdbd",
        marginTop: "3px"
      });
      b.appendChild(origLine);
    }
  }

  function paintBadge(bd, kind) {
    if (kind === "error") {
      bd.style.background = "rgba(120,53,15,0.95)";
      bd.style.color = "#fde68a";
    } else if (kind === "done") {
      bd.style.background = "rgba(22,101,52,0.95)";
      bd.style.color = "#dcfce7";
    } else {
      bd.style.background = "rgba(0,0,0,0.8)";
      bd.style.color = "#e5e5e5";
    }
  }

  function stopBadgeAnim() {
    if (badgeAnim) {
      clearInterval(badgeAnim);
      badgeAnim = null;
    }
  }

  // 右上角徽章 — 靜態訊息（完成 / 失敗等固定字串）。會先停掉進度動畫。
  function setBadge(text, kind) {
    stopBadgeAnim();
    if (!attachOverlay()) return;
    const bd = ensureBadge();
    if (!text) {
      bd.style.display = "none";
      return;
    }
    bd.style.display = "inline-block";
    bd.style.opacity = "1";
    bd.textContent = text;
    paintBadge(bd, kind);
  }

  // 右上角徽章 — 動態進度。spinner 持續轉動，即使進度數字暫時沒變，
  // 也一眼看得出仍在運作（而非卡住）。重複呼叫只更新文字、不重啟動畫。
  const BADGE_SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  function setBadgeProgress(label) {
    badgeLabel = label;
    if (!attachOverlay()) return;
    const bd = ensureBadge();
    bd.style.display = "inline-block";
    bd.style.opacity = "1";
    paintBadge(bd, "progress");
    if (!badgeAnim) {
      const tick = () => {
        badgeSpin = (badgeSpin + 1) % BADGE_SPIN.length;
        bd.textContent = `${BADGE_SPIN[badgeSpin]} ${badgeLabel}`;
      };
      tick();
      badgeAnim = setInterval(tick, 110);
    }
  }

  // 隱藏 / 還原 YouTube 原生字幕。用 <style> 而非直接改元素，
  // 因為 YouTube 會反覆重建字幕容器，CSS 規則對之後新建的也有效。
  function setNativeCaptionsHidden(on) {
    if (on) {
      if (hideStyleEl) return;
      hideStyleEl = document.createElement("style");
      hideStyleEl.id = "aiyu-hide-native-cc";
      hideStyleEl.textContent =
        ".ytp-caption-window-container,.caption-window{display:none!important;}";
      document.documentElement.appendChild(hideStyleEl);
    } else if (hideStyleEl) {
      hideStyleEl.remove();
      hideStyleEl = null;
    }
  }

  // 終止性失敗：字幕框顯示紅字錯誤，並停下（還原原生字幕，避免使用者完全沒字幕）
  function fail(msg) {
    render(msg, "error");
    setBadge("");
    stopSync();
    setNativeCaptionsHidden(false);
    active = false;
    delete document.documentElement.dataset.aiyuActive; // C 鍵交回 YouTube 原生切換
    waiting = false;
    translationDone = false;
    updateButton();
    updateMenuState();
  }

  // 拖曳：window 監聽全程只掛一次
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const player = document.querySelector(".html5-video-player");
    if (!player) return;
    const r = player.getBoundingClientRect();
    pos.cx = Math.min(95, Math.max(5, dragCX0 + ((e.clientX - dragSX) / r.width) * 100));
    pos.cy = Math.min(95, Math.max(5, dragCY0 + ((e.clientY - dragSY) / r.height) * 100));
    applyBoxPosition();
  });
  window.addEventListener("mouseup", () => {
    if (dragging) {
      dragging = false;
      if (box) box.style.cursor = "grab";
      try { localStorage.setItem("aiyu-yt-pos", JSON.stringify(pos)); } catch {}
    }
    // 縮放把手放開後存一次尺寸（瀏覽器會把寬高寫進 box.style）
    if (box && box.style.width) {
      boxSize = { w: box.style.width, h: box.style.height };
      try { localStorage.setItem("aiyu-yt-size", JSON.stringify(boxSize)); } catch {}
    }
  });

  // ---------- 原生字幕鈕 / C 鍵 → 切換我們的字幕框 ----------

  // aiyu 啟動時，把 YouTube 原生「字幕」鈕與 C 快捷鍵接管成「開關我們的雙語字幕框」。
  // 原生字幕全程維持隱藏：關掉只是收起我們的框（畫面無字幕），再切一次回來。
  // 回傳 true = 已接管（呼叫端據此擋掉 YouTube 自己的字幕切換）；false = 未啟動，不攔。
  function toggleOurCaptions() {
    if (!active) return false;
    userHidden = !userHidden;
    if (userHidden) {
      render("", "hidden");
    } else {
      curIdx = -1; // 強制下一 tick 重畫目前字幕
      syncTick();
    }
    return true;
  }

  // C 鍵：YouTube 的鍵盤快捷處理器會在 content script（isolated world）之前就吃掉 keydown，
  // 我們在這裡掛的 capture listener 搶不到（YT 先 stopImmediatePropagation）。改由
  // content/yt-key-shim.js（document_start + world:MAIN，比 YT 的 app 更早註冊 window capture）
  // 在 YT 自己的世界攔下 C、擋掉原生切換，再 dispatch 此事件過來；shim 只在 aiyu 啟動時
  // （<html data-aiyu-active="1">，於 start()/stop() 設定）才接管。
  window.addEventListener("aiyu-toggle-captions", () => {
    toggleOurCaptions();
  });

  // 原生字幕鈕：用 window capture 攔點擊（比按鈕自身的 handler 早觸發），改切換我們的框。
  // 按鈕點擊不走 YT 的鍵盤快捷系統，content script 的 capture 搶得到，故這條照常有效。
  window.addEventListener(
    "click",
    (e) => {
      if (!active) return;
      const t = e.target;
      if (!t || !t.closest || !t.closest(".ytp-subtitles-button")) return;
      if (toggleOurCaptions()) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  // ---------- 播放列按鈕 ----------

  function onButtonClick(e) {
    e.stopPropagation();
    if (active) stop();
    else start();
  }

  function updateButton() {
    const btn = document.querySelector(".aiyu-yt-btn");
    if (!btn) return;
    // 啟用時吉祥物全彩（愛玉色），停用時去飽和＋淡化
    btn.style.filter = active ? "none" : "grayscale(0.9)";
    btn.style.opacity = active ? "1" : "0.55";
    btn.title = active ? "關閉 aiyu 字幕翻譯" : "啟動 aiyu 字幕翻譯";
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }

  // 在播放列右側控制區注入aiyu 按鈕；YouTube 會重建控制列，故由輪詢持續確保它在
  function ensureButton() {
    const bar = document.querySelector(".ytp-right-controls");
    if (!bar) return;
    if (bar.querySelector(".aiyu-yt-btn")) {
      updateButton();
      return;
    }
    const btn = document.createElement("button");
    btn.className = "ytp-button aiyu-yt-btn";
    Object.assign(btn.style, {
      width: "48px",
      height: "100%",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      verticalAlign: "top",
      cursor: "pointer",
      transition: "filter .15s ease, opacity .15s ease"
    });
    const img = document.createElement("img");
    img.src = chrome.runtime.getURL("icons/logo.png");
    img.alt = "aiyu";
    img.draggable = false;
    Object.assign(img.style, {
      height: "20px",
      width: "auto",
      pointerEvents: "none",
      // 在 YouTube 深色控制列上加白色勾邊，讓吉祥物邊緣清楚（off/on 都套用）
      filter:
        "drop-shadow(1px 0 0 rgba(255,255,255,.95)) " +
        "drop-shadow(-1px 0 0 rgba(255,255,255,.95)) " +
        "drop-shadow(0 1px 0 rgba(255,255,255,.95)) " +
        "drop-shadow(0 -1px 0 rgba(255,255,255,.95))"
    });
    btn.appendChild(img);
    btn.addEventListener("click", onButtonClick);
    btn.addEventListener("mouseenter", showMenu);
    btn.addEventListener("mouseleave", scheduleHideMenu);
    // YouTube 的 .ytp-right-controls 內部還有 -left / -right 子容器，設定鈕是孫節點。
    // insertBefore 的參考節點必須是「呼叫者的直接子節點」，所以要對設定鈕「自己的
    // 父節點」呼叫 insertBefore，否則會丟 NotFoundError、按鈕永遠插不進去。
    const settings = bar.querySelector(".ytp-settings-button");
    if (settings && settings.parentElement) {
      settings.parentElement.insertBefore(btn, settings);
    } else {
      const slot =
        bar.querySelector(".ytp-right-controls-right") ||
        bar.querySelector(".ytp-right-controls-left") ||
        bar;
      slot.appendChild(btn);
    }
    updateButton();
  }

  // ---------- SRT 匯出 ----------

  // 秒 → SRT 時間碼 "HH:MM:SS,mmm"
  function formatSrtTime(sec) {
    const ms = Math.max(0, Math.round((sec || 0) * 1000));
    const p2 = (n) => String(n).padStart(2, "0");
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const mmm = String(ms % 1000).padStart(3, "0");
    return `${p2(h)}:${p2(m)}:${p2(s)},${mmm}`;
  }

  // 秒 → 面板用時間碼 "M:SS" 或 "H:MM:SS"(比 SRT 的 HH:MM:SS,mmm 精簡)
  function formatClock(sec) {
    const t = Math.max(0, Math.floor(sec || 0));
    const p2 = (n) => String(n).padStart(2, "0");
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t % 60;
    return h > 0 ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
  }

  // 由 cues 組出中英對照 SRT 字串。中文在上、英文在下;
  // 句子本來就是中文(text === zh)時只輸出一行,不重複。
  function buildBilingualSrt() {
    const lines = [];
    let n = 0;
    for (const c of cues) {
      const zh = String(c.zh ?? c.text ?? "").trim();
      const orig = String(c.text ?? "").trim();
      if (!zh && !orig) continue;
      n++;
      lines.push(String(n));
      lines.push(`${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}`);
      lines.push(zh || orig);
      if (orig && orig !== zh) lines.push(orig);
      lines.push(""); // 區塊間空行
    }
    return lines.join("\n");
  }

  // 檔名:影片標題去「 - YouTube」與檔名非法字元;取不到退回 videoId
  function srtFileName() {
    let title = String(document.title || "").replace(/\s*-\s*YouTube\s*$/, "").trim();
    title = title.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
    const base = title || videoId || "subtitles";
    return `${base}.zh-en.srt`;
  }

  // 建立(或取得)子選單。動作列的 click 透過 aria-disabled 守門。
  function ensureMenu() {
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = "aiyu-yt-menu";
    Object.assign(menu.style, {
      position: "absolute",
      display: "none",
      minWidth: "180px",
      padding: "6px 0",
      background: "rgba(28,28,28,0.96)",
      color: "#fff",
      borderRadius: "8px",
      boxShadow: "0 4px 18px rgba(0,0,0,0.55)",
      fontFamily: "'Noto Sans TC', system-ui, -apple-system, sans-serif",
      fontSize: "13px",
      lineHeight: "1.4",
      zIndex: "70",
      pointerEvents: "auto",
      userSelect: "none"
    });

    const mkRow = (label, onClick) => {
      const row = document.createElement("div");
      row.className = "aiyu-yt-menu-row";
      row.textContent = label;
      Object.assign(row.style, {
        padding: "8px 16px",
        cursor: "pointer",
        whiteSpace: "nowrap"
      });
      row.addEventListener("mouseenter", () => {
        if (row.getAttribute("aria-disabled") !== "true") {
          row.style.background = "rgba(255,255,255,0.12)";
        }
      });
      row.addEventListener("mouseleave", () => {
        row.style.background = "transparent";
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        if (row.getAttribute("aria-disabled") === "true") return;
        onClick();
      });
      return row;
    };

    menuOpenRow = mkRow("開啟雙語對照字幕", toggleTranscript);
    menuDownRow = mkRow("下載雙語對照 SRT", downloadSrt);
    menuRetransRow = mkRow("重新翻譯", retranslate); // 文案於 showMenu 補上目前模型

    menuHint = document.createElement("div");
    Object.assign(menuHint.style, {
      padding: "4px 16px 2px",
      fontSize: "11px",
      color: "#9aa0a6",
      whiteSpace: "nowrap",
      display: "none"
    });

    menu.appendChild(menuOpenRow);
    menu.appendChild(menuDownRow);
    menu.appendChild(menuRetransRow);
    menu.appendChild(menuHint);

    // 滑入選單 → 取消收合;離開 → 排程收合
    menu.addEventListener("mouseenter", () => clearTimeout(menuHideTimer));
    menu.addEventListener("mouseleave", scheduleHideMenu);
    return menu;
  }

  // 把選單掛進播放器容器(非 document.body)→ 全螢幕也能顯示
  function attachMenu() {
    const player = document.querySelector(".html5-video-player");
    if (!player) return false;
    if (getComputedStyle(player).position === "static") player.style.position = "relative";
    const m = ensureMenu();
    if (m.parentElement !== player) player.appendChild(m);
    return true;
  }

  // 依翻譯狀態切換動作列啟用/停用,並更新提示行
  function updateMenuState() {
    if (!menu) return;
    const ready = active && translationDone;
    for (const row of [menuOpenRow, menuDownRow, menuRetransRow]) {
      if (!row) continue;
      row.setAttribute("aria-disabled", ready ? "false" : "true");
      row.style.opacity = ready ? "1" : "0.4";
      row.style.cursor = ready ? "pointer" : "default";
      if (!ready) row.style.background = "transparent";
    }
    if (ready) {
      menuHint.style.display = "none";
    } else {
      menuHint.style.display = "block";
      // 0%（首批尚未翻好）顯示「連接模型中…」與徽章一致；此處同步無模型名故用泛用文案。
      menuHint.textContent = active
        ? (progressPct > 0 ? `翻譯中 ${progressPct}%` : "連接模型中…")
        : "請先啟動翻譯";
    }
  }

  // 選單右緣對齊按鈕右緣,底緣坐在按鈕上方
  function positionMenu() {
    const btn = document.querySelector(".aiyu-yt-btn");
    const player = document.querySelector(".html5-video-player");
    if (!btn || !player || !menu) return;
    const br = btn.getBoundingClientRect();
    const pr = player.getBoundingClientRect();
    menu.style.left = "auto";
    menu.style.right = Math.max(8, pr.right - br.right) + "px";
    menu.style.bottom = (pr.bottom - br.top + 8) + "px";
  }

  // 向 SW 查「目前設定會套用的模型」標籤(格式以 SW 的 modelLabel 為單一事實來源)。
  // 取「目前設定」而非「上次翻譯」：剛在 options 改了模型、尚未重翻時也要正確。
  async function fetchModelLabel() {
    try {
      const resp = await chrome.runtime.sendMessage({ type: "get-settings" });
      return resp?.model || "";
    } catch {
      return ""; // SW 不可用 → 空字串，呼叫端自行退回泛用文案
    }
  }

  // 「重新翻譯」文案補上目前模型，明確標示按下去會用哪個模型。
  async function refreshRetransLabel() {
    if (!menuRetransRow) return;
    const label = await fetchModelLabel();
    menuRetransRow.textContent = label ? `重新翻譯（${label}）` : "重新翻譯";
  }

  function showMenu() {
    if (!attachMenu()) return;
    clearTimeout(menuHideTimer);
    updateMenuState();
    refreshRetransLabel(); // 每次開選單即時反映目前模型(設定可能在選單關閉時被改過)
    menu.style.display = "block";
    positionMenu();
    // 選單開啟時暫時隱藏字幕框，避免字幕(常落在底部中央)蓋住選單。用 visibility 不動
    // render() 的 display 管理 → syncTick 仍在底下更新內容，收合後還原即顯示當前字幕。
    if (box) box.style.visibility = "hidden";
  }

  // 延遲收合:跨越「按鈕↔選單」空隙時不會秒收(滑入選單會 clearTimeout)
  function scheduleHideMenu() {
    clearTimeout(menuHideTimer);
    menuHideTimer = setTimeout(() => {
      if (menu) menu.style.display = "none";
      if (box) box.style.visibility = ""; // 選單收合 → 還原字幕框
    }, 200);
  }

  // 觸發瀏覽器存檔(共用:正常下載 + 開啟被彈窗封鎖時的退路)
  function triggerDownload(url) {
    const a = document.createElement("a");
    a.href = url;
    a.download = srtFileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // 下載:存出 .srt 檔
  function downloadSrt() {
    const srt = buildBilingualSrt();
    if (!srt) return;
    const url = URL.createObjectURL(new Blob([srt], { type: "text/plain;charset=utf-8" }));
    triggerDownload(url);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    scheduleHideMenu();
  }

  // ---------- 字幕面板(頁內同步列表) ----------

  // 建立(或取得)面板:右側疊層、可捲動、header 含 ×。不負責掛載。
  function ensureTranscriptPanel() {
    if (transcriptPanel) return transcriptPanel;
    transcriptPanel = document.createElement("div");
    transcriptPanel.id = "aiyu-yt-transcript";
    Object.assign(transcriptPanel.style, {
      // position(fixed/absolute) 與 left/top/width/height 由 mountTranscript /
      // applyTranscriptLayout 設定 — 此處只放與定位無關的外觀。
      display: "none",
      flexDirection: "column",
      minWidth: "240px",
      minHeight: "160px",
      background: "rgba(20,20,20,0.92)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.12)",
      borderRadius: "10px",
      boxShadow: "0 6px 24px rgba(0,0,0,0.6)",
      fontFamily: "system-ui, -apple-system, 'Noto Sans TC', 'PingFang TC', sans-serif",
      // 極高 z-index：浮在 YouTube 推薦影片側欄(#secondary)與其他頁面元素之上
      zIndex: "2147483646",
      pointerEvents: "auto",
      overflow: "hidden",
      resize: "both" // 右下角把手 — 可調整面板寬高
    });

    const header = document.createElement("div");
    Object.assign(header.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "8px 12px",
      borderBottom: "1px solid rgba(255,255,255,0.1)",
      fontSize: "13px",
      fontWeight: "600",
      flex: "0 0 auto",
      cursor: "move",      // header = 拖曳把手
      userSelect: "none"
    });
    // 左側群組：標題 + 模型標籤（header 用 space-between，故包成一組才不會被推散）
    const left = document.createElement("span");
    Object.assign(left.style, {
      display: "flex",
      alignItems: "baseline",
      gap: "8px",
      minWidth: "0",
      overflow: "hidden"
    });
    const title = document.createElement("span");
    title.textContent = "字幕";
    panelModelTag = document.createElement("span");
    panelModelTag.textContent = lastModelLabel; // 面板開啟前已翻過 → 顯示既有模型
    Object.assign(panelModelTag.style, {
      fontSize: "11px",
      fontWeight: "400",
      color: "#9aa0a6",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      minWidth: "0"
    });
    left.appendChild(title);
    left.appendChild(panelModelTag);
    const closeBtn = document.createElement("span");
    closeBtn.textContent = "×";
    Object.assign(closeBtn.style, {
      cursor: "pointer",
      fontSize: "18px",
      lineHeight: "1",
      padding: "0 4px",
      color: "#bbb"
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTranscript();
    });
    header.appendChild(left);
    header.appendChild(closeBtn);

    // 抓 header 拖曳整個面板（點 × 不觸發）。記下的是視窗座標(getBoundingClientRect)，
    // 與 trPos 的 left/top 同一基準 → 一般(fixed)與全螢幕(absolute,播放器原點=視窗原點)皆通用。
    header.addEventListener("mousedown", (e) => {
      if (e.target === closeBtn) return;
      const r = transcriptPanel.getBoundingClientRect();
      trDragging = true;
      trDragSX = e.clientX;
      trDragSY = e.clientY;
      trDragL0 = r.left;
      trDragT0 = r.top;
      e.preventDefault();
      e.stopPropagation();
    });

    transcriptList = document.createElement("div");
    Object.assign(transcriptList.style, {
      flex: "1 1 auto",
      overflowY: "auto",
      padding: "4px 0"
    });
    // 區分程式化捲動 vs 使用者捲動:自動捲動期間不記為使用者捲動
    transcriptList.addEventListener("scroll", () => {
      if (autoScrolling) return;
      lastUserScroll = Date.now();
    });

    // 搜尋列：夾在標題列與字幕清單之間。命中處逐個高亮，上/下一個捲動所屬字幕句置中。
    // 搜尋範圍排除時間碼(每行第一個子元素)，只搜中文/原文兩行 → children.slice(1)。
    transcriptSearch = window.aiyuCreateSearchBox({
      containers: () => transcriptRows.flatMap((r) => Array.from(r.children).slice(1)),
      onActivate: (mark) => {
        const row = mark.closest(".aiyu-yt-tr-row");
        if (row) scrollRowIntoView(row);
      },
      placeholder: "搜尋字幕…"
    });

    transcriptPanel.appendChild(header);
    transcriptPanel.appendChild(transcriptSearch.el);
    transcriptPanel.appendChild(transcriptList);

    // 全螢幕切換要換父節點(body↔全螢幕元素)；視窗縮放要重新夾住位置/尺寸。
    // 只掛一次，且僅在面板開著時才動作。
    if (!trFsHooked) {
      trFsHooked = true;
      document.addEventListener("fullscreenchange", () => {
        if (transcriptPanel && transcriptPanel.style.display !== "none") mountTranscript();
      });
      window.addEventListener("resize", () => {
        if (transcriptPanel && transcriptPanel.style.display !== "none") applyTranscriptLayout();
      });
    }
    return transcriptPanel;
  }

  function closeTranscript() {
    if (transcriptPanel) transcriptPanel.style.display = "none";
  }

  // 依 cues 建立面板行:時間碼 + 中文 +(英文)。點行跳轉。
  function buildTranscriptRows() {
    ensureTranscriptPanel();
    transcriptList.replaceChildren();
    transcriptRows = [];
    cues.forEach((c, idx) => {
      const zh = String(c.zh ?? c.text ?? "").trim();
      const orig = String(c.text ?? "").trim();
      const row = document.createElement("div");
      row.className = "aiyu-yt-tr-row";
      row.dataset.idx = String(idx);
      Object.assign(row.style, {
        padding: "6px 12px",
        cursor: "pointer",
        borderLeft: "3px solid transparent",
        transition: "background 0.15s ease"
      });

      const time = document.createElement("div");
      time.textContent = formatClock(c.start);
      Object.assign(time.style, {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "11px",
        color: "#8a8a8a"
      });

      const zhLine = document.createElement("div");
      zhLine.textContent = zh || orig;
      Object.assign(zhLine.style, { fontSize: "14px", color: "#fff", lineHeight: "1.4" });

      row.appendChild(time);
      row.appendChild(zhLine);
      if (orig && orig !== zh) {
        const enLine = document.createElement("div");
        enLine.textContent = orig;
        Object.assign(enLine.style, { fontSize: "12px", color: "#9aa0a6", lineHeight: "1.35" });
        row.appendChild(enLine);
      }

      row.addEventListener("mouseenter", () => {
        if (idx !== transcriptIdx) row.style.background = "rgba(255,255,255,0.06)";
      });
      row.addEventListener("mouseleave", () => {
        if (idx !== transcriptIdx) row.style.background = "transparent";
      });
      row.addEventListener("click", (e) => {
        e.stopPropagation();
        seekToCue(idx);
      });

      transcriptList.appendChild(row);
      transcriptRows.push(row);
    });
    transcriptBuiltFor = videoId;
    transcriptIdx = -1;
    if (transcriptSearch) transcriptSearch.refresh(); // 重建行後重算搜尋高亮/計數
  }

  // 點行 → 跳轉影片到該句起點(不強制 play)
  function seekToCue(idx) {
    const c = cues[idx];
    const video = getVideo();
    if (!c || !video) return;
    try { video.currentTime = c.start; } catch {}
  }

  // 只捲動面板 list(不用 scrollIntoView,以免連帶捲動整頁/全螢幕容器),把該行帶到中央
  function scrollRowIntoView(row) {
    if (!transcriptList || !row) return;
    const lr = transcriptList.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const delta = (rr.top - lr.top) - (transcriptList.clientHeight / 2 - row.clientHeight / 2);
    autoScrolling = true;
    transcriptList.scrollTo({ top: transcriptList.scrollTop + delta, behavior: "smooth" });
    setTimeout(() => { autoScrolling = false; }, 600);
  }

  // 切換高亮到第 idx 行;必要時自動捲到置中。idx=-1(空檔)忽略,保留上一句高亮。
  function updateTranscriptHighlight(idx) {
    if (!transcriptPanel || transcriptPanel.style.display === "none") return;
    if (idx < 0 || idx === transcriptIdx) return;
    const prev = transcriptRows[transcriptIdx];
    if (prev) {
      prev.style.background = "transparent";
      prev.style.borderLeftColor = "transparent";
    }
    const row = transcriptRows[idx];
    transcriptIdx = idx;
    if (!row) return;
    row.style.background = "rgba(62,166,255,0.18)";
    row.style.borderLeftColor = "#3ea6ff";
    // 使用者剛手動捲動過(4 秒內)→ 只換高亮、不硬拉回
    if (Date.now() - lastUserScroll > 4000) scrollRowIntoView(row);
  }

  // 掛載面板到正確父節點並依全螢幕狀態決定定位方式。
  // 全螢幕必須掛進全螢幕子樹(掛 body 會被瀏覽器整個隱藏)；
  // 一般/劇場模式掛 body 用 fixed，才能浮在播放器外的推薦影片之上。
  function mountTranscript() {
    const panel = ensureTranscriptPanel();
    const fsEl = document.fullscreenElement;
    if (fsEl) {
      panel.style.position = "absolute";
      if (getComputedStyle(fsEl).position === "static") fsEl.style.position = "relative";
      if (panel.parentElement !== fsEl) fsEl.appendChild(panel);
    } else {
      panel.style.position = "fixed";
      if (panel.parentElement !== document.body) document.body.appendChild(panel);
    }
    applyTranscriptLayout();
  }

  // 套用面板的 left/top/width/height(視窗 px)，並夾進可視範圍(至少留 40px 在畫面內)。
  function applyTranscriptLayout() {
    if (!transcriptPanel) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    let wPx = trSize?.w ? parseInt(trSize.w, 10) : Math.min(460, Math.round(vw * 0.32));
    let hPx = trSize?.h ? parseInt(trSize.h, 10) : Math.round(vh * 0.6);
    wPx = Math.max(240, Math.min(wPx, vw - 16));
    hPx = Math.max(160, Math.min(hPx, vh - 16));
    transcriptPanel.style.width = wPx + "px";
    transcriptPanel.style.height = hPx + "px";

    let left, top;
    if (trPos) { left = trPos.left; top = trPos.top; }
    else { left = vw - wPx - 24; top = Math.round(vh * 0.12); } // 預設右側，浮在推薦影片上
    left = Math.max(40 - wPx, Math.min(left, vw - 40));
    top = Math.max(0, Math.min(top, vh - 40));
    transcriptPanel.style.left = left + "px";
    transcriptPanel.style.top = top + "px";
    transcriptPanel.style.right = "auto";
    transcriptPanel.style.bottom = "auto";
  }

  // 面板拖曳的 window 監聽 — 與字幕框各用各的狀態(trDragging vs dragging)，互不干擾
  window.addEventListener("mousemove", (e) => {
    if (!trDragging || !transcriptPanel) return;
    const r = transcriptPanel.getBoundingClientRect();
    let left = trDragL0 + (e.clientX - trDragSX);
    let top = trDragT0 + (e.clientY - trDragSY);
    left = Math.max(40 - r.width, Math.min(left, window.innerWidth - 40));
    top = Math.max(0, Math.min(top, window.innerHeight - 40));
    trPos = { left, top };
    transcriptPanel.style.left = left + "px";
    transcriptPanel.style.top = top + "px";
  });
  window.addEventListener("mouseup", () => {
    if (trDragging) {
      trDragging = false;
      try { localStorage.setItem("aiyu-yt-tr-pos", JSON.stringify(trPos)); } catch {}
    }
    // CSS resize 會把寬高寫進 style → 放開時存一次(面板開著才存)
    if (transcriptPanel && transcriptPanel.style.display !== "none" && transcriptPanel.style.width) {
      trSize = { w: transcriptPanel.style.width, h: transcriptPanel.style.height };
      try { localStorage.setItem("aiyu-yt-tr-size", JSON.stringify(trSize)); } catch {}
    }
  });

  function openTranscript() {
    const panel = ensureTranscriptPanel();
    if (transcriptBuiltFor !== videoId || !transcriptRows.length) buildTranscriptRows();
    panel.style.display = "flex";
    mountTranscript(); // 依全螢幕狀態掛到 body 或全螢幕元素，並套用位置/尺寸
    // 開啟即捲到目前句:歸零 transcriptIdx 與 lastUserScroll,讓首次必定高亮+捲動
    transcriptIdx = -1;
    lastUserScroll = 0;
    const video = getVideo();
    if (video) updateTranscriptHighlight(findCueIndex(video.currentTime));
  }

  function toggleTranscript() {
    scheduleHideMenu(); // 順手收起子選單
    if (transcriptPanel && transcriptPanel.style.display !== "none") {
      closeTranscript();
    } else {
      openTranscript();
    }
  }

  // ---------- caption track ----------

  function getVideoId() {
    return new URLSearchParams(location.search).get("v") || "";
  }

  function getVideo() {
    return (
      document.querySelector("video.html5-main-video") ||
      document.querySelector(".html5-video-player video") ||
      document.querySelector("video")
    );
  }

  // 取 InnerTube API key（同源 fetch watch 頁 HTML，只為了挑出這個字串）
  async function fetchInnertubeKey() {
    const res = await fetch(location.href, { credentials: "include" });
    if (!res.ok) throw new Error("讀取頁面失敗 HTTP " + res.status);
    const html = await res.text();
    const m = html.match(/"INNERTUBE_API_KEY":\s*"([^"]+)"/);
    return m ? m[1] : null;
  }

  // 用 ANDROID InnerTube client 取得 player response。
  // 為什麼用 ANDROID：WEB client 的字幕網址帶 exp=xpe，需要 pot（proof-of-origin
  // token，瀏覽器端無法產生），下載會回傳 200 空內容；ANDROID client 的字幕網址
  // 不受 pot 限制，可直接下載。
  async function fetchAndroidPlayer(videoId) {
    const key = await fetchInnertubeKey();
    const url = "https://www.youtube.com/youtubei/v1/player" + (key ? "?key=" + key : "");
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "20.10.38"
      },
      body: JSON.stringify({
        context: { client: { clientName: "ANDROID", clientVersion: "20.10.38", hl: "en" } },
        videoId
      })
    });
    if (!res.ok) throw new Error("讀取影片資料失敗 HTTP " + res.status);
    return res.json();
  }

  // 從字幕軌清單挑一條要翻譯的。
  // 重點：要翻的是影片「口說的那個語言」，不是清單裡第一條非中文字幕 —
  // 多語影片（如 TED）字幕清單常有數十種語言，盲挑第一條會選到阿拉伯文之類。
  // ASR（自動字幕）是從聲音生成的，其 languageCode 即影片口說語言 → 用它定位原文。
  function pickTrack(pr) {
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks) || !tracks.length) return { track: null, allChinese: false };

    const langOf = (t) => (t.languageCode || "").toLowerCase();
    const asr = tracks.find((t) => t.kind === "asr");
    const origLang = asr ? langOf(asr) : "";

    // 影片本來就是中文 → 不需翻譯
    if (origLang && /^zh/.test(origLang)) return { track: null, allChinese: true };

    if (origLang) {
      // 同原始語言的人工字幕最佳；否則退回原始語言的 ASR
      const manualOrig = tracks.find((t) => t.kind !== "asr" && langOf(t) === origLang);
      if (manualOrig) return { track: manualOrig, allChinese: false };
      if (asr) return { track: asr, allChinese: false };
    }

    // 沒有 ASR 可判斷原始語言（少數舊片）→ 偏好英文，再不然第一條非中文
    const nonZh = tracks.filter((t) => !/^zh/.test(langOf(t)));
    if (!nonZh.length) return { track: null, allChinese: true };
    const en = nonZh.find((t) => /^en/.test(langOf(t)));
    return { track: en || nonZh[0], allChinese: false };
  }

  async function fetchCues(track) {
    const url = track.baseUrl.replace(/&fmt=[^&]*/g, "") + "&fmt=json3";
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("下載字幕內容失敗 HTTP " + res.status);
    const raw = (await res.text()).trim();
    if (!raw) throw new Error("YouTube 未提供此字幕內容（可能受地區或權限限制）");
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("字幕內容格式無法解析");
    }
    const events = Array.isArray(data.events) ? data.events : [];
    const out = [];
    let lastText = "";
    for (const ev of events) {
      if (!Array.isArray(ev.segs)) continue;
      const text = ev.segs
        .map((s) => s.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || text === lastText) continue;
      lastText = text;
      out.push({
        start: (ev.tStartMs || 0) / 1000,
        dur: (ev.dDurationMs || 0) / 1000,
        text,
        zh: null
      });
    }
    return out;
  }

  function computeEnds() {
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      const next = cues[i + 1];
      let end = c.dur > 0 ? c.start + c.dur : next ? next.start : c.start + 4;
      if (next && end > next.start) end = next.start;
      c.end = end;
    }
  }

  // ---------- translation ----------

  // 對 SW 發 translate 請求，並加上前端逾時防線。
  // MV3 service worker 閒置約 30s 就被回收；若它在等 CLI 回應時被回收，
  // 回應遺失、sendMessage 的 Promise 永不 resolve → worker 永遠卡住、進度停在 0。
  // SW 端已有 keepAlive，這裡再加一道前端逾時：萬一仍卡住，逾時後拋錯，
  // worker 會把該段標成原文、繼續下一段，不會整支影片卡死。
  function sendTranslate(segments) {
    return Promise.race([
      chrome.runtime.sendMessage({ type: "translate", segments, context: "youtube" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("翻譯回應逾時")), 110000)
      )
    ]);
  }

  // 把待翻譯的 cue 切成「段落」，每段是一次 CLI 呼叫的單位。
  // 用「字數」而非「句數」分組：單次 CLI 呼叫的延遲取決於 prompt/輸出大小，而字幕疏密差很多
  // (短片段 vs 長句) → 只有字數上限能穩定壓住每次呼叫時間。實測 claude haiku：2 併發、
  // 群組 prompt ~3300 約 23-32s 穩定完成；群組過大(prompt ~6500)其中一個會被拖過 host
  // 60s 上限被 SIGKILL → 卡進度。故壓小群組、保守留餘裕(瀏覽器播放佔 CPU、claude 變異大)。
  function groupCues(idxList) {
    const SOFT_CHARS = 800;  // 達此且句尾 → 收尾(對齊句界，譯文較完整)
    const HARD_CHARS = 1200; // 硬上限：壓住單次 prompt 大小，確保 2 併發也穩在 60s 內
    const groups = [];
    let cur = [];
    let chars = 0;
    for (const idx of idxList) {
      cur.push(idx);
      chars += (cues[idx].text || "").length;
      const endsSentence = /[.!?。！？]["'”’)）\]]?\s*$/.test(cues[idx].text);
      if ((chars >= SOFT_CHARS && endsSentence) || chars >= HARD_CHARS) {
        groups.push(cur);
        cur = [];
        chars = 0;
      }
    }
    if (cur.length) groups.push(cur);
    return groups;
  }

  // 記住並（若面板已開）顯示這次翻譯用的模型。面板開啟前先存著，建面板時帶入。
  function setPanelModel(model) {
    lastModelLabel = model || "";
    if (panelModelTag) panelModelTag.textContent = lastModelLabel;
  }

  // 一段一段翻譯：每個小段落翻完就立刻更新顯示，不必等整支影片翻完。
  // 開頭的段落最先送、最先顯示；翻譯速度遠快於播放速度，後段會在播到前就備妥。
  async function translateAllCues() {
    const todoIdx = [];
    cues.forEach((c, i) => {
      if (c.zh === null && c.text) todoIdx.push(i);
    });
    if (!todoIdx.length) {
      setBadge("");
      translationDone = true;
      updateMenuState();
      resumePlayback(); // 全部本來就是中文 → 無需等待，直接從頭播
      return;
    }

    const groups = groupCues(todoIdx);
    const taken = new Array(groups.length).fill(false);
    const total = todoIdx.length;
    let done = 0;
    let failed = 0;
    let firstError = "";
    let quotaHit = false; // 偵測到額度用盡 → 立刻中止整輪，不再連敲已鎖額度的 CLI
    progressPct = 0;
    // 第一批翻好前顯示「連接 <模型> 中…」而非「翻譯中 0%」：claude 首呼叫要十幾~數十秒，
    // 0% 久不動會像當機，明講「正在連接哪個模型」較不焦慮。
    const model = await fetchModelLabel();
    setBadgeProgress(model ? `連接 ${model} 模型中…` : "連接模型中…");
    updateMenuState();

    // 挑下一個要翻的段落 —— 不照固定順序，而是優先翻「使用者目前播放位置」
    // 所在 / 前方最近的段落。每當有 worker 空出來就重新評估，所以使用者中途
    // 跳轉(seek)後，接下來會自動改翻新位置 —— 跳到哪、那一段就最快有字幕。
    function pickGroup() {
      const video = getVideo();
      const t = video ? video.currentTime : 0;
      let best = -1;
      let bestScore = Infinity;
      for (let i = 0; i < groups.length; i++) {
        if (taken[i]) continue;
        const g = groups[i];
        const gStart = cues[g[0]].start;
        const gEnd = cues[g[g.length - 1]].end || gStart + 1;
        let score;
        if (t >= gStart && t < gEnd) score = 0;       // 播放點就在此段內 → 最優先
        else if (gStart >= t) score = gStart - t;      // 在播放點前方 → 越近越先翻
        else score = (t - gEnd) * 3 + 100000;          // 已播過 → 大幅延後（仍會翻）
        if (score < bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) return null;
      taken[best] = true;
      return groups[best];
    }

    // 送一組 cue 去翻譯並套用結果；成功回 true。一組 = 一次 CLI 呼叫。
    // 不做 hedge（先前：呼叫逾 20s 未回就並送一份備援）。claude 等 CLI 每次有
    // ~20s 固定開銷（實測：1 句 24.8s、40 句 19.5s，幾乎與批次大小無關），
    // 會讓 20s 的 hedge 幾乎每次必觸發 → 併發翻倍、多個重量級行程互搶資源 →
    // 撞 host 60s 上限被 SIGKILL → 進度卡死。實測單次/2 併發 claude 都 < 60s，
    // 移除 hedge 即解；偶發整組失敗仍由 worker 的「拆半重試」兜底。
    async function translateGroup(idxList) {
      if (!idxList.length) return true;
      const segments = idxList.map((idx) => ({ id: String(idx), text: cues[idx].text }));

      let resp = null;
      try {
        const r = await sendTranslate(segments);
        if (r?.ok && Array.isArray(r.results)) resp = r;
        else {
          const err = r?.error || "host 無回應";
          if (!firstError) firstError = err;
          if (err.includes("額度用盡")) quotaHit = true;
        }
      } catch (e) {
        const err = e?.message || "連線中斷";
        if (!firstError) firstError = err;
        if (err.includes("額度用盡")) quotaHit = true;
      }

      if (!resp) return false;
      if (resp.model) setPanelModel(resp.model);
      const byId = new Map(resp.results.map((r) => [String(r.id), r.zh]));
      for (const idx of idxList) {
        const zh = byId.get(String(idx));
        cues[idx].zh = zh && String(zh).trim() ? String(zh) : cues[idx].text;
      }
      return true;
    }

    async function worker() {
      while (active && !quotaHit) {
        const group = pickGroup();
        if (!group) return;
        let ok = await translateGroup(group);
        if (quotaHit) return; // 額度用盡 → 立刻收工，不拆半重試、不再拉新段落
        if (!ok && active) {
          // 整組失敗 → 拆半重試：較小的呼叫較不易卡。改「序列」而非並行 —— claude 等
          // 重量級後端若並行兩個半組，又會重演「互相餓死、雙雙超時」；序列雖略慢但穩。
          const half = Math.ceil(group.length / 2);
          const a = await translateGroup(group.slice(0, half));
          const b = active ? await translateGroup(group.slice(half)) : false;
          ok = a && b;
        }
        if (!active) return;
        if (!ok) {
          failed++;
          // 仍沒翻到的 cue 顯示原文，不要讓它一直卡在「翻譯中…」
          for (const idx of group) if (cues[idx].zh === null) cues[idx].zh = cues[idx].text;
        }
        done += group.length;
        curIdx = -1; // 這組翻好了 → 立刻重畫目前字幕
        // 緩衝足夠才從頭自動播放：開頭起連續翻好的字幕需覆蓋 ≥ PREROLL_SEC 秒，
        // 播放才不易追上翻譯前線。等待期 pickGroup 以 t=0 為中心 → 自然先補開頭。
        // 翻譯失敗時 worker 會把 zh 設成原文 → lead 仍會推進、不會卡死。
        if (waiting && leadSeconds() >= PREROLL_SEC) resumePlayback();
        if (active && done < total) {
          progressPct = Math.round((done / total) * 100);
          setBadgeProgress(`翻譯中 ${progressPct}%`);
          updateMenuState();
        }
      }
    }

    // 並行 2 條(三後端一致)。搭配 groupCues 的字數上限：小群組單次 ~20-30s，2 併發也穩在
    // 60s 內、不超時。先前的大群組才會在 2 併發下互相餓死、其中一個被 host 60s 砍 → 卡進度；
    // 縮小群組後即解。無 hedge(見 translateGroup)，故同時最多 2 個 CLI 呼叫。
    await Promise.all([worker(), worker()]);
    if (!active) return;
    resumePlayback(); // 保險：偵測若漏掉，全部翻完仍會恢復播放

    // 診斷：印出實際錯誤字串，方便判斷是否被正確辨識為「額度用盡」
    if (firstError) console.warn("[aiyu] 翻譯結束有錯誤，firstError =", JSON.stringify(firstError));
    if (quotaHit) {
      // 額度用盡是「需使用者處理」的狀態 → 右上角持續顯示、不自動淡出。
      setBadge("⚠ 翻譯額度用盡，請稍後再試", "error");
    } else if (failed >= groups.length) {
      setBadge("⚠ 翻譯失敗", "error");
      flashDoneBadge(8000);
    } else if (failed > 0) {
      setBadge("⚠ 部分未翻譯", "error");
      flashDoneBadge(6000);
    } else {
      setBadge("✓ 翻譯完成", "done");
      flashDoneBadge(4000);
    }
    translationDone = true; // 含部分失敗也算完成(失敗句 zh 已回退原文)
    updateMenuState();
  }

  // 「重新翻譯」：套用目前模型重翻整支。清掉既有譯文後重跑翻譯。
  // 因 SW 的 cache key 已含模型，切換模型後重翻會 cache miss → 取得新模型譯文；
  // 模型未變則命中既有快取(等同沿用目前模型，預期一致)。不重抓字幕。
  // 行為比照初次翻譯：enterWaiting() 暫停並跳回 0，集滿 PREROLL_SEC 緩衝後自動從頭播放。
  async function retranslate() {
    scheduleHideMenu();
    if (!active || !translationDone) return; // 僅翻完後可重翻(updateMenuState 已守門，雙保險)
    for (const c of cues) c.zh = null; // 全部標為待翻：重翻就是重翻整支
    translationDone = false;
    progressPct = 0;
    curIdx = -1;             // 強制重畫目前字幕
    transcriptBuiltFor = ""; // 面板下次開啟時用新譯文重建
    updateMenuState();       // 翻譯中 → 停用動作列、顯示進度
    enterWaiting();          // 暫停並跳回 0；worker 集滿 PREROLL_SEC 緩衝後自動從頭播放
    await translateAllCues();
    // 重翻完成：面板若開著，用新譯文重建行並重新高亮目前句
    if (transcriptPanel && transcriptPanel.style.display !== "none") {
      buildTranscriptRows();
      const video = getVideo();
      transcriptIdx = -1;
      if (video) updateTranscriptHighlight(findCueIndex(video.currentTime));
    }
  }

  // 顯示一段時間後淡出徽章 — completion / 失敗看一下就好，不長駐擋畫面
  function flashDoneBadge(ms) {
    clearTimeout(doneFlashTimer);
    doneFlashTimer = setTimeout(() => {
      if (!badge) return;
      badge.style.opacity = "0";
      setTimeout(() => { if (badge) badge.style.display = "none"; }, 480);
    }, ms);
  }

  // ---------- timeline sync ----------

  function findCueIndex(t) {
    if (curIdx >= 0 && curIdx < cues.length) {
      const c = cues[curIdx];
      if (t >= c.start && t < c.end) return curIdx;
    }
    for (let i = 0; i < cues.length; i++) {
      if (t >= cues[i].start && t < cues[i].end) return i;
    }
    return -1;
  }

  function syncTick() {
    if (!active) return;
    if (getVideoId() !== videoId) {
      // 使用者換了影片 — 舊字幕失效，安靜停下（播放列按鈕會回到未啟動狀態）
      stop();
      return;
    }
    if (waiting) {
      // 等待期間凍結在開頭、保住等待提示不被洗掉。
      // 但若使用者等不及自己按了播放，尊重操作 → 立刻交回正常同步。
      const v = getVideo();
      if (v && !v.paused) resumePlayback();
      return;
    }
    attachOverlay();
    const video = getVideo();
    if (!video) return;
    const i = findCueIndex(video.currentTime);
    updateTranscriptHighlight(i); // 面板高亮獨立跟隨;-1 由它自行忽略
    if (userHidden) {
      // 使用者按 C／原生字幕鈕關掉了我們的字幕框 → 收起框，面板高亮仍照常跟隨
      render("", "hidden");
      curIdx = -1;
      return;
    }
    if (i === -1) {
      // 字幕空檔（含首句之前）— 一律清空，避免殘留前置狀態訊息
      render("", "hidden");
      curIdx = -1;
      return;
    }
    if (i === curIdx) return;
    curIdx = i;
    renderCue(cues[i]);
  }

  function startSync() {
    if (syncTimer) return;
    syncTimer = setInterval(syncTick, SYNC_MS);
    syncTick();
  }

  function stopSync() {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  }

  // ---------- preroll：等開頭緩衝備足再從頭播 ----------

  // 從開頭起、連續已翻好的字幕覆蓋到第幾秒（碰到第一個還沒翻好的句子就停在那）。
  // cues 依時間碼遞增 → index 序即時間序；空字幕(無 text)比照 todo 規則視為已備妥。
  // 全部翻好回 Infinity。worker 每翻完一組就用它判斷緩衝是否已達 PREROLL_SEC。
  function leadSeconds() {
    for (let i = 0; i < cues.length; i++) {
      const c = cues[i];
      if (c.text && c.zh == null) return c.start;
    }
    return Infinity;
  }

  // 進入等待期：暫停並跳回影片最開頭，字幕框顯示「請耐心等候」。
  // seek 到 0 也讓 pickGroup() 以 currentTime=0 為中心，自然最先翻開頭那一批。
  function enterWaiting() {
    waiting = true;
    const video = getVideo();
    if (video) {
      video.pause();
      try { video.currentTime = 0; } catch {}
    }
    render("⏳ 翻譯準備中，請耐心等候…\n好了會自動從頭播放", "status");
  }

  // 離開等待期、從開頭自動播放。waiting 旗標守門 → 重複呼叫安全。
  function resumePlayback() {
    if (!waiting) return;
    waiting = false;
    render("", "hidden"); // 清掉等待提示，畫面交回 syncTick
    curIdx = -1;          // 強制下一次 tick 重畫
    const video = getVideo();
    if (video) {
      // 影片在按 aiyu 之前本來就在播（是我們主動暫停的），故 play() 幾乎一定被允許；
      // 萬一仍被 autoplay 政策擋下，就停在 0、字幕已備妥，使用者自行按播放即可。
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    syncTick(); // 立刻畫出開頭字幕
  }

  // ---------- control ----------

  async function start() {
    if (active) return;
    active = true;
    document.documentElement.dataset.aiyuActive = "1"; // 通知 yt-key-shim（main world）接管 C 鍵
    curIdx = -1;
    userHidden = false;
    cues = [];
    translationDone = false;
    progressPct = 0;
    transcriptBuiltFor = "";
    clearTimeout(doneFlashTimer);
    updateButton();
    updateMenuState();

    videoId = getVideoId();
    if (!videoId) {
      fail("請先開啟一支 YouTube 影片再啟動字幕翻譯");
      return;
    }

    setBadgeProgress("讀取字幕軌…");
    try {
      const pr = await fetchAndroidPlayer(videoId);
      if (!active) return;
      const { track, allChinese } = pickTrack(pr);
      if (allChinese) {
        fail("此影片字幕本來就是中文，無需翻譯");
        return;
      }
      if (!track) {
        fail("找不到字幕軌(影片可能未提供字幕，或為直播)");
        return;
      }

      setBadgeProgress("下載字幕內容…");
      cues = await fetchCues(track);
      if (!active) return;
      if (!cues.length) {
        fail("字幕軌是空的，換一支有字幕的影片試試");
        return;
      }
      computeEnds();

      // 暫停並跳回開頭，等開頭那批翻好再自動播 — 否則翻譯太慢，翻好時已播過開頭。
      // 只在這支影片的第一次翻譯這樣做；重譯同一支影片則略過(waiting 保持 false →
      // 連帶 seek-to-0 / 暫停 / resumePlayback 全部自然跳過 → 原地翻譯不干擾播放)。
      if (!jumpedVideoIds.has(videoId)) {
        jumpedVideoIds.add(videoId);
        enterWaiting();
      }
      // 立刻開始跟隨時間軸；尚未翻好的句子會先顯示「翻譯中…」
      startSync();
      setNativeCaptionsHidden(true); // 隱藏原生字幕，只留我們的雙語字幕框
      await translateAllCues();
    } catch (e) {
      if (active) fail("字幕翻譯失敗：" + (e?.message || "未知錯誤"));
    }
  }

  function stop() {
    active = false;
    delete document.documentElement.dataset.aiyuActive; // C 鍵交回 YouTube 原生切換
    waiting = false;
    userHidden = false;
    stopSync();
    clearTimeout(doneFlashTimer);
    setNativeCaptionsHidden(false);
    cues = [];
    curIdx = -1;
    translationDone = false;
    closeTranscript();
    transcriptBuiltFor = "";
    transcriptIdx = -1;
    render("", "hidden");
    setBadge("");
    updateButton();
    updateMenuState();
  }

  // 持續確保播放列按鈕存在（YouTube 換頁 / 重建控制列都會把它清掉）
  setInterval(ensureButton, 1000);
  ensureButton();
})();

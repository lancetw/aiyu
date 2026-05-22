// aiyu 選取翻譯 — 右鍵翻譯選取的文字，譯文顯示在可拖曳/縮放的浮動視窗中。
// 視窗行為比照 YouTube 字幕列表面板：position:fixed 浮在最上層、標題列可拖曳、
// 右下角可縮放、只用標題列的 × 關閉(不再點外面就消失)、含關鍵字搜尋列。
// 位置每次貼齊選取文字，僅「大小」記住(localStorage)。
(() => {
  if (window.__aiyuArticleLoaded) return;
  window.__aiyuArticleLoaded = true;

  let bubble = null;
  let bubbleBody = null;
  let searchBox = null;

  // 拖曳狀態放模組層級：window 監聽只掛一次，避免重複掛載
  let dragging = false;
  let dragSX = 0, dragSY = 0, dragL0 = 0, dragT0 = 0;
  // 是否為 Chrome PDF 檢視器頁：PDF 上拖曳/縮放改用 pointer + 外框延遲套用(見 setupPdfInteractions)
  let isPdf = false;
  // 僅記大小(寬高字串)；位置不記，每次開窗貼齊選取文字
  let selSize = loadJSON("aiyu-sel-size", null);
  // 字級(px)，記住跨開窗。預設 14，範圍 11–28。
  let selFont = clampSelFont(Number(localStorage.getItem("aiyu-sel-font")) || 14);
  // 譯文/原文排版：stack=上下(譯上原下，預設) | cols=左右並排(譯左原右)。記住跨開窗。
  let selLayout = localStorage.getItem("aiyu-sel-layout") === "cols" ? "cols" : "stack";
  let layoutBtn = null;

  // Chrome 的 info.selectionText 會把換行替換成空白(crbug 116429) → 右鍵當下自行用
  // window.getSelection() 擷取(保留換行)，存起來供 sw 透過 aiyu-get-selection 取用。
  let lastSelectionText = "";

  function clampSelFont(n) {
    return Math.min(28, Math.max(11, n || 14));
  }

  function loadJSON(k, dflt) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : dflt;
    } catch {
      return dflt;
    }
  }
  function saveJSON(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
  }

  // 選取範圍的視窗座標(供 fixed 定位用)；無選取回 null
  function selectionRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return rect;
  }

  // 把 active 命中處捲到 body 中央 — 只捲 body 自己，不連帶捲動整頁
  function scrollBodyToMark(mark) {
    if (!bubbleBody || !mark) return;
    const cr = bubbleBody.getBoundingClientRect();
    const mr = mark.getBoundingClientRect();
    const delta = mr.top - cr.top - (bubbleBody.clientHeight / 2 - mr.height / 2);
    bubbleBody.scrollTo({ top: bubbleBody.scrollTop + delta, behavior: "smooth" });
  }

  // Chrome 內建 PDF 檢視器：頂層文件含 <embed>(型別隨版本為 application/pdf 或
  // application/x-google-chrome-pdf)。此偵測法與 Hypothesis 等標註擴充一致。
  function isPdfDoc() {
    try {
      if (document.contentType === "application/pdf") return true;
    } catch { /* 某些情境 contentType 不可讀 */ }
    return !!document.querySelector(
      'embed[type="application/pdf"], embed[type="application/x-google-chrome-pdf"]'
    );
  }

  // PDF(out-of-process 外掛)上，逐幀改變浮層的位置/尺寸都會逼外掛區跨進程重新合成 → 拖曳/縮放卡頓；
  // 且原生 window mousemove 在游標移到 PDF <embed> 上時不會觸發(事件落入外掛子框架)。
  // 解法：移動(標題列)與縮放(右下把手)都改用 pointer + setPointerCapture(事件全程留在把手、不外洩到
  // PDF)，過程只移動透明虛線外框(幾乎不重繪)，放開滑鼠才把位置/尺寸一次套回氣泡。
  function setupPdfInteractions(b, header, title) {
    b.classList.add("aiyu-bubble-pdf"); // CSS 關掉原生 resize 把手

    // 依氣泡目前位置/大小建立預覽外框
    function makeOutline() {
      const r = b.getBoundingClientRect();
      const o = document.createElement("div");
      o.className = "aiyu-resize-outline";
      o.style.left = r.left + "px";
      o.style.top = r.top + "px";
      o.style.width = r.width + "px";
      o.style.height = r.height + "px";
      document.body.appendChild(o);
      return { o, r };
    }

    // 拖曳標題列移動：放開才套位置
    header.addEventListener("pointerdown", (e) => {
      if (e.target !== header && e.target !== title) return; // 按按鈕不觸發
      e.preventDefault();
      try { header.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const { o, r } = makeOutline();
      const sx = e.clientX, sy = e.clientY, l0 = r.left, t0 = r.top, w = r.width;
      const move = (ev) => {
        o.style.left = Math.max(40 - w, Math.min(l0 + (ev.clientX - sx), window.innerWidth - 40)) + "px";
        o.style.top = Math.max(0, Math.min(t0 + (ev.clientY - sy), window.innerHeight - 40)) + "px";
      };
      const up = () => {
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", up);
        header.removeEventListener("pointercancel", up);
        b.style.left = o.style.left;
        b.style.top = o.style.top;
        o.remove();
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", up);
      header.addEventListener("pointercancel", up);
    });

    // 右下把手縮放：放開才套尺寸
    const grip = document.createElement("div");
    grip.className = "aiyu-bubble-grip";
    grip.title = "拖曳縮放";
    b.appendChild(grip);
    grip.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { grip.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const { o, r } = makeOutline();
      const sx = e.clientX, sy = e.clientY, sw = r.width, sh = r.height;
      const move = (ev) => {
        o.style.width = Math.max(240, sw + (ev.clientX - sx)) + "px"; // 對齊 CSS min-width
        o.style.height = Math.max(120, sh + (ev.clientY - sy)) + "px"; // 對齊 CSS min-height
      };
      const up = () => {
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
        b.style.width = parseFloat(o.style.width) + "px";
        b.style.height = parseFloat(o.style.height) + "px";
        o.remove();
        selSize = { w: b.style.width, h: b.style.height };
        saveJSON("aiyu-sel-size", selSize);
      };
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
  }

  // 建立(或取得)浮動視窗：標題列(可拖曳, 含 ×) + 搜尋列 + 可捲動 body。只建一次。
  function ensureBubble() {
    if (bubble && document.body.contains(bubble)) return bubble;

    bubble = document.createElement("div");
    bubble.className = "aiyu-bubble";

    const header = document.createElement("div");
    header.className = "aiyu-bubble-header";
    const title = document.createElement("span");
    title.className = "aiyu-bubble-title";
    title.textContent = "翻譯";
    layoutBtn = document.createElement("button");
    layoutBtn.className = "aiyu-bubble-fontbtn aiyu-bubble-layoutbtn";
    layoutBtn.addEventListener("click", () =>
      setLayout(selLayout === "cols" ? "stack" : "cols")
    );
    const fontDown = document.createElement("button");
    fontDown.className = "aiyu-bubble-fontbtn";
    fontDown.textContent = "A−";
    fontDown.title = "縮小文字";
    fontDown.addEventListener("click", () => setFont(selFont - 2));
    const fontUp = document.createElement("button");
    fontUp.className = "aiyu-bubble-fontbtn";
    fontUp.textContent = "A＋";
    fontUp.title = "放大文字";
    fontUp.addEventListener("click", () => setFont(selFont + 2));
    const close = document.createElement("button");
    close.className = "aiyu-bubble-close";
    close.textContent = "×";
    close.title = "關閉";
    close.addEventListener("click", () => { bubble.style.display = "none"; });
    header.append(title, layoutBtn, fontDown, fontUp, close);

    // 只在按到標題列空白處或標題文字才拖曳(按按鈕不觸發)。記視窗座標，與 fixed 同基準。
    header.addEventListener("mousedown", (e) => {
      if (isPdf) return; // PDF 改用 pointer + 外框延遲套用(見 setupPdfInteractions)
      if (e.target !== header && e.target !== title) return;
      const r = bubble.getBoundingClientRect();
      dragging = true;
      dragSX = e.clientX; dragSY = e.clientY;
      dragL0 = r.left; dragT0 = r.top;
      e.preventDefault();
    });

    // Ctrl/Cmd + 滾輪縮放字級；一般滾輪留給 body 捲動譯文。
    bubble.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setFont(selFont + (e.deltaY < 0 ? 2 : -2));
      },
      { passive: false }
    );

    searchBox = window.aiyuCreateSearchBox({
      containers: () => [bubbleBody],
      onActivate: (mark) => scrollBodyToMark(mark),
      placeholder: "搜尋譯文/原文…"
    });

    bubbleBody = document.createElement("div");
    bubbleBody.className = "aiyu-bubble-body";

    bubble.append(header, searchBox.el, bubbleBody);
    document.body.appendChild(bubble);
    applyLayout(); // 初始化排版按鈕標籤
    isPdf = isPdfDoc();
    if (isPdf) setupPdfInteractions(bubble, header, title); // PDF 上拖曳/縮放改「放開才套用」，避免逐幀卡頓
    return bubble;
  }

  // 開窗：套用記住的大小，若視窗原本隱藏才貼齊選取文字(避免內容更新時跳位)
  function openWindow() {
    const wasHidden = !bubble || bubble.style.display === "none" || !document.body.contains(bubble);
    ensureBubble();
    applyFont();
    if (selSize?.w) bubble.style.width = selSize.w;
    if (selSize?.h) bubble.style.height = selSize.h;
    bubble.style.display = "flex";
    if (wasHidden) positionAtSelection();
  }

  function positionAtSelection() {
    const rect = selectionRect();
    const w = bubble.offsetWidth || 320;
    let left, top;
    if (rect) { left = rect.left; top = rect.bottom + 8; }
    else { left = Math.round(window.innerWidth * 0.3); top = Math.round(window.innerHeight * 0.18); }
    left = Math.max(8, Math.min(left, window.innerWidth - 40));
    top = Math.max(8, Math.min(top, window.innerHeight - 40));
    // 視窗底超出畫面時，改貼選取範圍上方
    if (rect && top + (bubble.offsetHeight || 160) > window.innerHeight - 8) {
      top = Math.max(8, rect.top - (bubble.offsetHeight || 160) - 8);
    }
    void w;
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
  }

  function setFont(n) {
    selFont = clampSelFont(n);
    applyFont();
    try { localStorage.setItem("aiyu-sel-font", String(selFont)); } catch { /* ignore */ }
  }
  // 字級套在 body：zh 用 1em、原文 0.85em，兩行隨之等比縮放
  function applyFont() {
    if (bubbleBody) bubbleBody.style.fontSize = selFont + "px";
  }

  // 套用排版到目前結果(若有)並更新按鈕標籤；按鈕顯示「切換後」的方向圖示。
  function applyLayout() {
    const pair = bubbleBody && bubbleBody.querySelector(".aiyu-bubble-pair");
    if (pair) pair.classList.toggle("cols", selLayout === "cols");
    if (layoutBtn) {
      layoutBtn.textContent = selLayout === "cols" ? "⇅" : "⇆";
      layoutBtn.title = selLayout === "cols" ? "改為上下堆疊（譯上原下）" : "改為左右並排（譯左原右）";
    }
  }
  function setLayout(mode) {
    selLayout = mode === "cols" ? "cols" : "stack";
    try { localStorage.setItem("aiyu-sel-layout", selLayout); } catch { /* ignore */ }
    applyLayout();
  }

  // 填 body 內容並標記種類(error 紅字只套在 body)。內容變了 → 重跑搜尋高亮。
  function setBody(content, kind) {
    bubbleBody.replaceChildren();
    bubbleBody.dataset.kind = kind;
    if (typeof content === "string") bubbleBody.textContent = content;
    else bubbleBody.appendChild(content);
    if (searchBox) searchBox.refresh();
  }

  function showSelectionLoading() {
    openWindow();
    const wrap = document.createElement("span");
    wrap.className = "aiyu-loading-inline";
    const label = document.createElement("span");
    label.textContent = "翻譯中";
    wrap.appendChild(label);
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "aiyu-dot";
      dot.style.animationDelay = `${i * 0.18}s`;
      dot.textContent = "·";
      wrap.appendChild(dot);
    }
    setBody(wrap, "loading");
  }

  function showSelectionResult(original, zh) {
    openWindow();
    const wrap = document.createElement("div");
    wrap.className = "aiyu-bubble-pair" + (selLayout === "cols" ? " cols" : "");
    const t = document.createElement("div");
    t.className = "aiyu-bubble-zh";
    t.textContent = zh || "（無翻譯結果）";
    const o = document.createElement("div");
    o.className = "aiyu-bubble-original";
    o.textContent = original;
    // 譯文在前(上/左)、原文在後(下/右)
    wrap.append(t, o);
    setBody(wrap, "ok");
  }

  function showSelectionError(err) {
    openWindow();
    setBody("翻譯失敗：" + err, "error");
  }

  // 拖曳/縮放的 window 監聽，掛一次。CSS resize 把寬高寫進 style → 放開時存大小。
  window.addEventListener("mousemove", (e) => {
    if (!dragging || !bubble) return;
    const w = bubble.offsetWidth, h = bubble.offsetHeight;
    let left = dragL0 + (e.clientX - dragSX);
    let top = dragT0 + (e.clientY - dragSY);
    left = Math.max(40 - w, Math.min(left, window.innerWidth - 40));
    top = Math.max(0, Math.min(top, window.innerHeight - 40));
    bubble.style.left = left + "px";
    bubble.style.top = top + "px";
    void h;
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
    if (bubble && bubble.style.display !== "none" && bubble.style.width) {
      selSize = { w: bubble.style.width, h: bubble.style.height };
      saveJSON("aiyu-sel-size", selSize);
    }
  });

  // 右鍵當下擷取選取文字(保留換行)。capture 階段先於頁面自身的處理。
  window.addEventListener(
    "contextmenu",
    () => {
      lastSelectionText = (window.getSelection && window.getSelection().toString()) || "";
    },
    true
  );

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "aiyu-get-selection") {
      const live = (window.getSelection && window.getSelection().toString()) || "";
      sendResponse({ text: lastSelectionText || live });
      return;
    }
    if (msg?.type === "aiyu-show-selection-loading") {
      showSelectionLoading();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "aiyu-show-selection") {
      showSelectionResult(msg.original, msg.zh);
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "aiyu-show-selection-error") {
      showSelectionError(msg.error);
      sendResponse({ ok: true });
      return;
    }
  });
})();

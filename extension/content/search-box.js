// aiyu 共用搜尋元件 — 右鍵翻譯視窗與字幕列表面板共用。
// 提供「輸入框 + 上一個/下一個 + 計數(目前/總數)」的搜尋列，並在指定容器內
// 逐個關鍵字出現處包成 <mark> 高亮、可逐處導覽。
//
// 控制反轉：本元件只負責「找出/高亮/計數/切換 active」，不知道內容是字幕還是
// 譯文；「該如何把 active 捲進視野」交回各視窗的 onActivate 處理 —— 因為直接
// scrollIntoView 會連帶捲動整頁，各視窗有自己的捲動容器要處理。
//
// 由 manifest 在 article.js 與 youtube.js 之前注入；youtube.com 上兩個 content
// script 都會載入本檔，故用旗標防重複定義。
(() => {
  if (window.aiyuCreateSearchBox) return;

  // 高亮樣式注入一次。色彩需在淺底(右鍵視窗)與深底(字幕面板)都清楚 → 黃底黑字、
  // active 用橘底；輸入框/按鈕用 color:inherit 跟著各視窗前景色走。
  function injectStyleOnce() {
    if (document.getElementById("aiyu-search-style")) return;
    const s = document.createElement("style");
    s.id = "aiyu-search-style";
    s.textContent = `
.aiyu-search-box { display:flex; align-items:center; gap:4px; padding:5px 8px;
  border-bottom:1px solid rgba(127,127,127,0.25); flex:0 0 auto; }
.aiyu-search-input { flex:1 1 auto; min-width:0; font:inherit; font-size:13px;
  padding:3px 7px; border:1px solid rgba(127,127,127,0.4); border-radius:5px;
  background:transparent; color:inherit; outline:none; }
.aiyu-search-input:focus { border-color:rgba(127,127,127,0.7); }
.aiyu-search-count { font-size:12px; opacity:0.7; min-width:40px; text-align:center;
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.aiyu-search-nav { border:none; background:transparent; cursor:pointer; color:inherit;
  font-size:17px; line-height:1; padding:2px 7px; border-radius:5px; opacity:0.8; }
.aiyu-search-nav:hover { background:rgba(127,127,127,0.2); opacity:1; }
.aiyu-search-nav:disabled { opacity:0.3; cursor:default; background:transparent; }
mark.aiyu-search-hit { background:#ffe066; color:#000; border-radius:2px; padding:0 1px; }
mark.aiyu-search-hit-active { background:#ff9f1a; color:#000; }`;
    document.documentElement.appendChild(s);
  }

  // 在單一容器子樹內，把 query 的每個出現處(不分大小寫)包成 <mark>。
  // 先一次收齊文字節點再改寫 —— 邊走 TreeWalker 邊改 DOM 會漏節點。
  function highlightContainer(root, query, lowerQuery, marks) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        n.nodeValue && n.nodeValue.length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    });
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    for (const node of nodes) {
      const text = node.nodeValue;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(lowerQuery);
      if (idx === -1) continue;
      const frag = document.createDocumentFragment();
      let last = 0;
      while (idx !== -1) {
        if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
        const mark = document.createElement("mark");
        mark.className = "aiyu-search-hit";
        mark.textContent = text.slice(idx, idx + query.length);
        frag.appendChild(mark);
        marks.push(mark);
        last = idx + query.length;
        idx = lower.indexOf(lowerQuery, last);
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // containers : () => Element[]  要搜尋的容器(每次呼叫即時取得，內容重建後也能反映)
  // onActivate : (markEl, index, total) => void  active 換人時由宿主決定如何捲進視野
  // placeholder: string
  window.aiyuCreateSearchBox = function createSearchBox({ containers, onActivate, placeholder }) {
    injectStyleOnce();

    const box = document.createElement("div");
    box.className = "aiyu-search-box";
    const input = document.createElement("input");
    input.className = "aiyu-search-input";
    input.type = "text";
    input.placeholder = placeholder || "搜尋…";
    const count = document.createElement("span");
    count.className = "aiyu-search-count";
    const prev = document.createElement("button");
    prev.className = "aiyu-search-nav";
    prev.textContent = "‹";
    prev.title = "上一個 (Shift+Enter)";
    const next = document.createElement("button");
    next.className = "aiyu-search-nav";
    next.textContent = "›";
    next.title = "下一個 (Enter)";
    box.append(input, count, prev, next);

    let marks = [];
    let active = -1;

    function clear() {
      containers().forEach((root) => {
        if (!root) return;
        root.querySelectorAll("mark.aiyu-search-hit").forEach((m) => {
          m.parentNode.replaceChild(document.createTextNode(m.textContent), m);
        });
        root.normalize(); // 合併相鄰文字節點，下次搜尋才不會被切碎的詞卡住
      });
      marks = [];
      active = -1;
    }

    function updateCount() {
      count.textContent = marks.length
        ? `${active + 1}/${marks.length}`
        : input.value
        ? "0/0"
        : "";
      const none = marks.length === 0;
      prev.disabled = none;
      next.disabled = none;
    }

    function setActive(i) {
      if (!marks.length) {
        active = -1;
        updateCount();
        return;
      }
      if (active >= 0 && marks[active]) marks[active].classList.remove("aiyu-search-hit-active");
      active = ((i % marks.length) + marks.length) % marks.length; // 環狀，越界自動繞回
      const m = marks[active];
      m.classList.add("aiyu-search-hit-active");
      updateCount();
      if (typeof onActivate === "function") onActivate(m, active, marks.length);
    }

    function run() {
      const q = input.value;
      clear();
      if (q) containers().forEach((root) => root && highlightContainer(root, q, q.toLowerCase(), marks));
      if (marks.length) setActive(0);
      else updateCount();
    }

    let debounce;
    input.addEventListener("input", () => {
      clearTimeout(debounce);
      debounce = setTimeout(run, 120);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (marks.length) setActive(active + (e.shiftKey ? -1 : 1));
      else run();
    });
    prev.addEventListener("click", () => setActive(active - 1));
    next.addEventListener("click", () => setActive(active + 1));

    updateCount();

    return {
      el: box,
      focus: () => input.focus(),
      // 內容重建後(如字幕重新整理)呼叫，用目前關鍵字重新高亮、重算計數
      refresh: run
    };
  };
})();

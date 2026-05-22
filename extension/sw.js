// aiyu service worker — 中介 content script 與 native host
// 設計重點：
//   * port 懶建立、自動重連（service worker 會被回收）
//   * LRU 快取（記憶體即可，sw 重啟丟失可接受）
//   * 多請求並發 → 用 id 對應 callback

const HOST_NAME = "com.lancetw.aiyu";
const CACHE_MAX = 1000;

const cache = new Map(); // key -> {zh, ts}
const pending = new Map(); // id -> {resolve, reject}
let port = null;
let nextId = 1;

function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return null;
  cache.delete(key);
  cache.set(key, v); // LRU bump
  return v.zh;
}

function cacheSet(key, zh) {
  if (cache.size >= CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { zh, ts: Date.now() });
}

function makeKey(text, target, style, context) {
  // context 入 key：同一段文字在不同情境（口譯／翻譯記者）會有不同譯法，
  // 不含 context 會讓先翻的情境污染後翻的情境（拿到錯人格的快取）。
  return `${target}|${style}|${context}|${text}`;
}

function ensurePort() {
  if (port) return port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (e) {
    port = null;
    throw new Error("無法連線 native host：" + e.message);
  }
  port.onMessage.addListener((msg) => {
    const cb = pending.get(msg.id);
    if (!cb) return;
    pending.delete(msg.id);
    refreshKeepAlive();
    if (msg.error) cb.reject(new Error(msg.error));
    else cb.resolve({ result: msg.result, meta: msg.meta });
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message || "native host disconnected";
    for (const { reject } of pending.values()) reject(new Error(err));
    pending.clear();
    refreshKeepAlive();
    port = null;
  });
  return port;
}

// MV3 service worker 閒置約 30s 就會被回收；翻譯一個小段落的 CLI 呼叫常超過 30s。
// 若 SW 在等 host 回應時被回收，回應遺失、translate 永遠不回覆 → 字幕卡在 0。
// 有未完成的 callHost 時，每 20s 觸發一次 chrome API 重置 idle 計時器，保住 SW。
let keepAliveTimer = null;
function refreshKeepAlive() {
  if (pending.size > 0 && !keepAliveTimer) {
    keepAliveTimer = setInterval(() => {
      chrome.runtime.getPlatformInfo(() => {});
    }, 20000);
  } else if (pending.size === 0 && keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

async function callHost(action, payload, timeoutMs = 90000) {
  const id = nextId++;
  const p = ensurePort();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    refreshKeepAlive();
    try {
      p.postMessage({ id, action, ...payload });
    } catch (e) {
      pending.delete(id);
      refreshKeepAlive();
      reject(e);
    }
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        refreshKeepAlive();
        reject(new Error("翻譯逾時"));
      }
    }, timeoutMs);
  });
}

async function getSettings() {
  const d = await chrome.storage.sync.get({
    cli: "codex",
    codexModel: "gpt-5.4-mini",
    claudeModel: "haiku",
    target: "zh-TW",
    style: "natural",
    customPrompt: "",
    glossary: []
  });
  return d;
}

async function translateBatch(segments, settings, context) {
  // segments: [{id, text}]；context: "youtube" | "selection" 等，決定 host 端譯者人格
  const out = new Array(segments.length);
  const need = [];
  segments.forEach((s, i) => {
    const k = makeKey(s.text, settings.target, settings.style, context);
    const hit = cacheGet(k);
    if (hit !== null) out[i] = { id: s.id, zh: hit, cached: true };
    else need.push({ idx: i, seg: s, key: k });
  });

  if (need.length === 0) return out;

  // agy（Antigravity）模型由帳號端自動路由、無法在 print 模式指定 → 不帶 model
  const model =
    settings.cli === "codex" ? settings.codexModel
    : settings.cli === "claude" ? settings.claudeModel
    : null;
  const { result, meta } = await callHost("translate", {
    cli: settings.cli,
    model,
    target: settings.target,
    style: settings.style,
    context,
    customPrompt: settings.customPrompt,
    glossary: settings.glossary,
    segments: need.map((n) => ({ id: n.seg.id, text: n.seg.text }))
  });

  // 若 host 自動 fallback 到別的 CLI，把使用者偏好同步成實際可用的
  if (meta?.fellBack && meta?.usedCli) {
    try {
      await chrome.storage.sync.set({ cli: meta.usedCli });
    } catch {}
  }

  // result: [{id, zh}]
  const byId = new Map(result.map((r) => [r.id, r.zh]));
  for (const n of need) {
    const zh = byId.get(n.seg.id) ?? n.seg.text;
    cacheSet(n.key, zh);
    out[n.idx] = { id: n.seg.id, zh };
  }
  return out;
}

// ----- Context Menus -----

const MENU_IDS = {
  SELECTION: "aiyu-selection"
};

const MENU_DEFS = [
  { id: MENU_IDS.SELECTION, title: "aiyu：翻譯選取文字", contexts: ["selection"] }
];

async function setupMenus() {
  // Promise 化 removeAll，避免 callback 內的 create 因 SW 被回收而流失
  await new Promise((resolve) => {
    try { chrome.contextMenus.removeAll(resolve); } catch { resolve(); }
  });
  for (const def of MENU_DEFS) {
    try {
      chrome.contextMenus.create(def, () => {
        if (chrome.runtime.lastError) {
          console.warn("[aiyu] menu create lastError", def.id, chrome.runtime.lastError.message);
        }
      });
    } catch (e) {
      console.warn("[aiyu] menu create threw", def.id, e.message);
    }
  }
  console.log("[aiyu] setupMenus done, items =", MENU_DEFS.length);
}

let menusInstalled = false;
async function ensureMenus() {
  if (menusInstalled) return;
  menusInstalled = true;
  try {
    await setupMenus();
  } catch (e) {
    menusInstalled = false;
    console.warn("[aiyu] ensureMenus failed", e);
  }
}

chrome.runtime.onInstalled.addListener(() => { ensureMenus(); });
chrome.runtime.onStartup.addListener(() => { ensureMenus(); });

async function translateSelection(text, tabId, frameId) {
  if (!text || !text.trim()) return;
  const settings = await getSettings();
  const results = await translateBatch(
    [{ id: "sel", text: text.trim() }],
    settings,
    "selection"
  );
  const zh = results?.[0]?.zh || "";
  try {
    await chrome.tabs.sendMessage(
      tabId,
      { type: "aiyu-show-selection", original: text, zh },
      frameId != null ? { frameId } : undefined
    );
  } catch {
    /* tab might have navigated away */
  }
}

// Chrome 的 info.selectionText 會把換行替換成空白(crbug 116429)。改向 content script
// 要 window.getSelection().toString()(保留換行)；取不到(如 iframe 未注入)才退回 fallback。
async function getSelectionText(tabId, frameId, fallback) {
  try {
    const resp = await chrome.tabs.sendMessage(
      tabId,
      { type: "aiyu-get-selection" },
      frameId != null ? { frameId } : undefined
    );
    const t = resp?.text;
    if (t && t.trim()) return t;
  } catch {
    /* content script 不在該 frame → 用 fallback */
  }
  return fallback || "";
}

// 把對應的 content script 注入分頁。content script 有 __aiyuLoaded guard，
// 重複注入是安全的（guard 會讓它 early return，不重複註冊 listener）。
async function ensureContentScripts(tab) {
  if (!tab?.id) return false;
  const url = tab.url || "";
  if (!/^https?:\/\//.test(url)) return false; // chrome:// 等受限頁面無法注入
  const isYouTube = /^https?:\/\/[^/]*\.?youtube\.com\//.test(url);
  const files = isYouTube
    ? ["content/youtube.js", "content/article.js"]
    : ["content/article.js"];
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["content/article.css"]
    });
    return true;
  } catch {
    return false;
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ensureMenus();
  if (!tab?.id) return;
  if (info.menuItemId === MENU_IDS.SELECTION) {
    // 確保 content script 在（擴充套件載入前就開的分頁不會有）
    await ensureContentScripts(tab);
    // 先即時告知 tab「翻譯中」氣泡
    chrome.tabs.sendMessage(
      tab.id,
      { type: "aiyu-show-selection-loading", original: info.selectionText },
      info.frameId != null ? { frameId: info.frameId } : undefined
    ).catch(() => {});
    try {
      const selText = await getSelectionText(tab.id, info.frameId, info.selectionText);
      await translateSelection(selText, tab.id, info.frameId);
    } catch (e) {
      chrome.tabs.sendMessage(
        tab.id,
        { type: "aiyu-show-selection-error", error: e.message },
        info.frameId != null ? { frameId: info.frameId } : undefined
      ).catch(() => {});
    }
  }
});

// ----- Runtime messages -----

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    ensureMenus(); // 防呆：第一次 message 也保證 menus 已註冊

    try {
      if (msg.type === "translate") {
        const settings = await getSettings();
        const results = await translateBatch(msg.segments, settings, msg.context);
        sendResponse({ ok: true, results });
      } else if (msg.type === "ping-host") {
        const r = await callHost("ping", {}, 15000);
        sendResponse({ ok: true, info: r.result });
      } else if (msg.type === "get-settings") {
        sendResponse({ ok: true, settings: await getSettings() });
      } else if (msg.type === "clear-cache") {
        cache.clear();
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async
});

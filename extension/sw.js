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

function makeKey(text, target, style, context, backend) {
  // context 入 key：同一段文字在不同情境（口譯／翻譯記者）會有不同譯法，
  // 不含 context 會讓先翻的情境污染後翻的情境（拿到錯人格的快取）。
  // backend(=cli:model) 入 key 同理：不同模型/後端譯法不同，切換模型後同段文字
  // 應重新翻譯而非命中舊模型快取；切回舊模型則仍能命中其既有快取。
  return `${backend}|${target}|${style}|${context}|${text}`;
}

// 模型清單／標籤工具的單一來源 = shared/models.js。瀏覽器(classic SW)走 importScripts；
// node 測試走 require。兩者都把 AIYU 掛到全域(self/globalThis)。
if (typeof importScripts === "function") importScripts("shared/models.js");
else if (typeof require === "function") require("./shared/models.js");
const { resolveModel, modelLabel, DEFAULT_MODEL, DEFAULT_GLOSSARY } = AIYU;

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
    codexModel: DEFAULT_MODEL.codex,
    claudeModel: DEFAULT_MODEL.claude,
    target: "zh-TW",
    style: "natural",
    customPrompt: "",
    // glossary＝詞庫「內容」（單一來源 shared/models.js）；glossaryEnabled＝是否套用（gate）。
    // 兩者正交，且預設「不啟用」(opt-in)：使用者須在進階設定勾「啟用台灣詞庫」並儲存才生效。
    glossary: DEFAULT_GLOSSARY,
    glossaryEnabled: false
  });
  return d;
}

// 把 host 回傳對回 need：每筆明確標記是否「真譯文」。host 漏回某 id 或回空字串/空白
// （限流、輸出截斷、模型漏段時會發生）→ real:false、zh:null —— 絕不偽裝成原文。
// 純函式、無快取副作用 → 可單獨測試（test/sw-merge-results.test.js）。real 旗標讓上層
// （youtube worker）精準分辨「真譯文 vs 未翻譯」，據此重試而非靜默漏譯。
function mergeHostResults(need, result) {
  const byId = new Map((result || []).map((r) => [r.id, r.zh]));
  return need.map((n) => {
    const got = byId.get(n.seg.id);
    const real = got != null && String(got).trim() !== "";
    return { idx: n.idx, id: n.seg.id, key: n.key, zh: real ? String(got) : null, real };
  });
}

async function translateBatch(segments, settings, context) {
  // segments: [{id, text}]；context: "youtube" | "selection" 等，決定 host 端譯者人格
  const model = resolveModel(settings);
  // backend 入 key，使切換模型/後端後同段文字重新翻譯（見 makeKey）。
  const backend = `${settings.cli}:${model ?? ""}`;

  const out = new Array(segments.length);
  const need = [];
  segments.forEach((s, i) => {
    const k = makeKey(s.text, settings.target, settings.style, context, backend);
    const hit = cacheGet(k);
    if (hit !== null) out[i] = { id: s.id, zh: hit, cached: true, real: true };
    else need.push({ idx: i, seg: s, key: k });
  });

  if (need.length === 0) {
    // 全部命中快取：因 key 已含 backend，命中者必為當前模型所譯 → 標籤即當前模型。
    return { results: out, model: modelLabel(settings.cli, model) };
  }

  // timeout 320s：必須 > host 全後端 300s 上限，host 才會先逾時並回乾淨訊息
  //（CLI timeout／額度用盡），而非 SW 先誤判逾時。三層階梯：
  // host 300s < SW 320s < 前端 sendTranslate 340s。
  const { result, meta } = await callHost("translate", {
    cli: settings.cli,
    model,
    target: settings.target,
    style: settings.style,
    context,
    customPrompt: settings.customPrompt,
    // opt-in：未啟用就送空詞庫，host 端 buildPrompt 收到空陣列自然不組 glossaryBlock。
    glossary: settings.glossaryEnabled ? settings.glossary : [],
    segments: need.map((n) => ({ id: n.seg.id, text: n.seg.text }))
  }, 320000);

  // 預設標籤為使用者要求的模型；若 host fallback 到別的 CLI，改記實際使用的後端。
  let usedCli = settings.cli;
  let usedModel = model;
  // 若 host 自動 fallback 到別的 CLI，把使用者偏好同步成實際可用的
  if (meta?.fellBack && meta?.usedCli) {
    usedCli = meta.usedCli;
    usedModel = null; // fallback 後 host 用對方 CLI 的預設模型，名稱未知 → 只顯示後端名
    try {
      await chrome.storage.sync.set({ cli: meta.usedCli });
    } catch {}
  }

  // result: [{id, zh}] → 標明每筆是否真譯文（漏回/空 → real:false, zh:null，不偽裝原文）。
  const merged = mergeHostResults(need, result);
  for (const m of merged) {
    // 只快取真譯文：host 漏回/回空(限流、輸出截斷)不快取回退值，否則把原文/空字串鎖進快取，
    // 限流恢復後重翻也拿不到中文。
    if (m.real) cacheSet(m.key, m.zh);
    // zh:null 明確代表「未翻譯」→ 交由上層 youtube worker 重試；selection 則回退原文顯示。
    out[m.idx] = { id: m.id, zh: m.real ? m.zh : null, real: m.real };
  }
  return { results: out, model: modelLabel(usedCli, usedModel) };
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
  const { results, model } = await translateBatch(
    [{ id: "sel", text: text.trim() }],
    settings,
    "selection"
  );
  // 選取翻譯是一次性、無重試迴圈：未譯(zh:null)就回退顯示原文，至少不給空白氣泡。
  const zh = results?.[0]?.zh || text;
  try {
    await chrome.tabs.sendMessage(
      tabId,
      { type: "aiyu-show-selection", original: text, zh, model },
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

// 右鍵當下要注入哪些 content script。抽成純函式供 test/ 驗證相依順序。
// search-box.js 定義 window.aiyuCreateSearchBox，article.js:208 / youtube.js:833 依賴之
// → search-box.js 必須排在它們之前。YouTube 上 declarative 已先載 search-box，此處重列
//   屬冗餘但無害（各 content script 有 __aiyuLoaded 旗標防重複）。
function contentScriptFiles(url) {
  const isYouTube = /^https?:\/\/[^/]*\.?youtube\.com\//.test(url || "");
  return isYouTube
    ? ["content/search-box.js", "content/translate-scheduler.js", "content/youtube.js", "content/article.js"]
    : ["content/search-box.js", "content/article.js"];
}

// 把對應的 content script 注入分頁。content script 有 __aiyuLoaded guard，
// 重複注入是安全的（guard 會讓它 early return，不重複註冊 listener）。
async function ensureContentScripts(tab) {
  if (!tab?.id) return false;
  const url = tab.url || "";
  // file:// 也放行(本機 PDF)；注意 file:// 需在 chrome://extensions 開「允許存取檔案網址」，
  // 否則 executeScript 會擲錯。chrome://、PDF 檢視器自身的 chrome-extension:// 框架仍無法注入。
  if (!/^(https?|file):\/\//.test(url)) return false;
  const files = contentScriptFiles(url);
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

// file:// 需使用者在 chrome://extensions 開「允許存取檔案網址」,否則內容腳本注入會失敗。
// 注入失敗時頁面內無從顯示氣泡 → 明講原因,避免變成無聲的「右鍵沒反應」。
async function warnInjectBlocked(url) {
  if (/^file:\/\//.test(url || "")) {
    const allowed = await new Promise((resolve) => {
      try { chrome.extension.isAllowedFileSchemeAccess((ok) => resolve(!!ok)); }
      catch { resolve(false); }
    });
    if (!allowed) {
      console.warn("[aiyu] 本機檔案需在 chrome://extensions → aiyu → 詳細資料開啟「允許存取檔案網址」後才能翻譯");
      return;
    }
  }
  console.warn("[aiyu] 此頁面無法注入內容腳本,無法顯示翻譯氣泡:", url);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  await ensureMenus();
  if (!tab?.id) return;
  if (info.menuItemId === MENU_IDS.SELECTION) {
    // 氣泡是 position:fixed 的分頁級浮層，一律送最上層框架(frameId 0)：article.js 只注入
    // 最上層(manifest all_frames 預設 false)。PDF 檢視器/一般 iframe 的選取在子框架，
    // 送 info.frameId 會落在沒有 aiyu listener 的框架被丟棄 → 氣泡完全不出現。
    const injected = await ensureContentScripts(tab);
    if (!injected) {
      // 注入失敗(受限頁面，或 file:// 未開檔案存取) → 頁面內無從顯示氣泡，不再送注定被丟棄的訊息
      await warnInjectBlocked(tab.url);
      return;
    }
    // 先即時告知 tab「翻譯中」氣泡
    chrome.tabs.sendMessage(
      tab.id,
      { type: "aiyu-show-selection-loading", original: info.selectionText },
      { frameId: 0 }
    ).catch(() => {});
    try {
      // 選取文字仍向「選取所在框架」要(保留換行)；子框架無 article.js 時退回 info.selectionText
      const selText = await getSelectionText(tab.id, info.frameId, info.selectionText);
      await translateSelection(selText, tab.id, 0);
    } catch (e) {
      chrome.tabs.sendMessage(
        tab.id,
        { type: "aiyu-show-selection-error", error: e.message },
        { frameId: 0 }
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
        const { results, model } = await translateBatch(msg.segments, settings, msg.context);
        sendResponse({ ok: true, results, model });
      } else if (msg.type === "ping-host") {
        const r = await callHost("ping", {}, 15000);
        sendResponse({ ok: true, info: r.result });
      } else if (msg.type === "get-settings") {
        const settings = await getSettings();
        // model：目前設定會套用的模型標籤（供 UI 顯示「按下去會用哪個模型」）。
        sendResponse({ ok: true, settings, model: modelLabel(settings.cli, resolveModel(settings)) });
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

// node 測試用：瀏覽器/SW 環境無 module，故守衛匯出純邏輯供 test/ 載入，不影響執行。
if (typeof module !== "undefined" && module.exports) {
  module.exports = { translateBatch, mergeHostResults, contentScriptFiles };
}

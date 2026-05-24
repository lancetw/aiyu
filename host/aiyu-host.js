#!/Users/lancetw/.nvm/versions/node/v24.11.0/bin/node
// aiyu native messaging host
// 從 stdin 讀 4-byte LE length + JSON，呼叫 claude -p 或 codex exec，回 JSON 結果。
// 所有除錯訊息走 stderr，stdout 嚴格只能寫 framing message。

"use strict";

const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const HOST_VERSION = "0.3.2";
// 單次 CLI 呼叫上限：全後端統一 300s。健康呼叫遠低於此（claude ~24s、codex ~15s），
// 300s 幾乎只有真正卡死/中斷/伺服器負載或額度退避拉長時才觸發 → 不再誤砍正在正常工作的
// 呼叫。偶發失敗（含 codex 罕見的「整個卡住」）由前端 scheduler 優先重試、bounded 後大聲
// 標示兜底，不會無聲漏譯。
// timeout 階梯（外層必須比內層寬，否則外層先砍、host 放寬白做）：
//   host(本檔 300s) < SW callHost(320s) < 前端 sendTranslate(340s)。
const SPAWN_TIMEOUT_MS = 300_000;
// log 寫在腳本同目錄 — Chrome 啟動的是安裝副本（~/Library/Application Support/aiyu/），
// 該目錄 TCC 可寫；smoke test 從 repo 跑則寫在 host/。
const LOG_FILE = process.env.AIYU_LOG || path.join(__dirname, "aiyu-host.log");

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ")}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
  process.stderr.write(line);
}

// ----- Native Messaging framing -----

let stdinBuf = Buffer.alloc(0);

function writeMessage(obj) {
  const json = Buffer.from(JSON.stringify(obj), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(json.length, 0);
  process.stdout.write(len);
  process.stdout.write(json);
}

process.stdin.on("data", (chunk) => {
  stdinBuf = Buffer.concat([stdinBuf, chunk]);
  while (true) {
    if (stdinBuf.length < 4) return;
    const len = stdinBuf.readUInt32LE(0);
    if (stdinBuf.length < 4 + len) return;
    const body = stdinBuf.slice(4, 4 + len).toString("utf8");
    stdinBuf = stdinBuf.slice(4 + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch (e) {
      log("bad json", body.slice(0, 200));
      continue;
    }
    handleMessage(msg).catch((e) => {
      log("handler crashed", e.stack || e.message);
      writeMessage({ id: msg.id, error: e.message });
    });
  }
});

process.stdin.on("end", () => process.exit(0));

// ----- CLI invocation -----

function buildPrompt({ target, style, glossary, customPrompt, segments, context }) {
  const targetLabel =
    target === "zh-TW"
      ? "台灣繁體中文（正體中文，台灣地區用語）"
      : target === "zh-CN"
      ? "簡體中文"
      : target === "ja"
      ? "日本語"
      : target;

  const styleNote =
    style === "literal"
      ? "翻譯風格：直譯，盡量保留原句結構與術語精確度。"
      : style === "academic"
      ? "翻譯風格：正式、學術、書面語氣。"
      : "翻譯風格：自然流暢，符合目標語言母語者閱讀習慣。";

  const glossaryBlock =
    Array.isArray(glossary) && glossary.length
      ? "請特別遵守以下用詞對照（左為其他用法，右為應採用之譯詞）：\n" +
        glossary.map(([a, b]) => `- ${a} → ${b}`).join("\n")
      : "";

  const customBlock = customPrompt ? `額外指示：\n${customPrompt}` : "";

  // 台灣在地化用詞：一句指示＋高頻錨點，靠模型自身知識類推其餘 —— 用來取代沉重的詞庫
  //（啟用詞庫每次呼叫多扛 ~2300 字、Opus 超線性變慢）。使用者可關閉詞庫、改靠這段。
  // 僅 zh-TW 適用；其他目標語言不加（filter(Boolean) 會自然濾掉空字串）。
  const taiwanTermNote =
    target === "zh-TW"
      ? "用詞在地化：一律採台灣慣用的資訊科技與日常譯詞，避免對岸用語。例如：" +
        "優化→最佳化、軟件→軟體、硬件→硬體、數據→資料、文件→檔案、程序→程式、" +
        "函數→函式、默認→預設、緩存→快取、視頻→影片、網絡→網路、信息→資訊、" +
        "服務器→伺服器、用戶→使用者、質量→品質、性能→效能。未列出的詞亦比照（採台灣慣用語）。"
      : "";

  // 依情境切換譯者人格：YouTube 字幕＝「聽人說話」→ 即時口譯；
  // 其餘（選取文字／網頁書面文字）＝「讀書面內容」→ 翻譯記者（編譯）。
  const isSubtitle = context === "youtube";

  const persona = isSubtitle
    ? "你是一位專業資深的即時口譯員，具備母語級的雙語駕馭力與跨領域背景知識，" +
      `能即時、精準地把內容轉譯成道地的「${targetLabel}」。`
    : "你是一位專業資深的翻譯記者（編譯），長年處理跨國新聞與專業內容，" +
      `譯筆精準、可讀性高，能把內容如實轉譯成道地的「${targetLabel}」。`;

  const principles = (isSubtitle
    ? [
        "口譯準則：",
        "1. 意義優先：傳達說話者的真實意圖、語氣與言下之意，不逐字硬翻；成語、俚語、文化用語改用目標語言的對等說法。字幕是被切碎的短句，務必把整批段落當成連續上下文來理解，不可孤立逐句翻。",
        "1b. 詞義與修辭判讀：一詞多義時依整批上下文選最貼切的義；遇到刻意的比喻、雙關或專門用法，要保留其修辭意圖，不可機械取字典首義，也不可把比喻硬拆成字面。",
        "2. 自然順口：譯文要像專業口譯員當場脫口而出的母語，通順好懂、毫無翻譯腔。",
        "3. 流暢化：原文的口語贅詞、語助詞、結巴與無意義重複（um、you know、「那個…」）在不損失資訊下自然濾除。",
        "4. 語氣對應：講者正式就正式、輕鬆就輕鬆、帶情緒就保留情緒。",
        "5. 全篇連貫：把所有段落視為同一場談話的連續脈絡，專有名詞、術語、人物代稱前後保持一致，同一詞不要忽而兩種譯法。",
        "6. 忠實不臆造：不增添原文沒有的資訊、不自行評論、不漏譯關鍵內容；無法判斷時以最忠實的方式處理，絕不編造。"
      ]
    : [
        "編譯準則：",
        "1. 意義與事實並重：忠實傳達原文的事實、論點與語氣，不逐字硬翻；成語、慣用語改用目標語言的對等說法。",
        "1b. 詞義與修辭判讀：一詞多義時依上下文選最貼切的義；遇到刻意的比喻、雙關或專門用法，要保留其修辭意圖，不可機械取字典首義，也不可把比喻硬拆成字面。",
        "2. 書面流暢：譯文要像母語記者撰寫的通順書面文字，遣詞精準、結構清晰、毫無翻譯腔。",
        "3. 譯名規範：人名、地名、機構、職稱採約定俗成的通用譯名，全篇統一。",
        "4. 語域對應：原文正式就正式、論述就保留論述語氣，維持應有的客觀與精確。",
        "5. 精確還原：數據、引述、專有名詞如實譯出，不誇大、不弱化。",
        "6. 忠實不臆造：不增添原文沒有的資訊、不夾帶個人評論、不漏譯關鍵內容；無法判斷時以最忠實的方式處理，絕不編造。"
      ])
    .concat("（若上方已指定翻譯風格，語域與直譯／意譯的程度以該風格為準。）")
    .join("\n");

  const rules = [
    "輸出規則：",
    "1. 每個輸入 id 都必須有且僅有一筆對應譯文，逐段一一對應——不可遺漏、合併或新增 id（「精煉」只在同一段內進行，不得刪減段落）。",
    "2. 只有這些保留原文、不翻譯：程式碼、指令／變數／函式名、URL、檔名、真正的專有名詞（特定人名、產品或品牌名）。其餘一律譯出——月份、星期、單位、職稱、一般名詞等常見字詞都要翻成目標語言（如 December→十二月），不可因為是英文或首字母大寫就保留原文。數字本身的格式維持不變。",
    "3. 保留 Markdown 標記（粗體、斜體、連結語法）。",
    "4. 不要解釋、不要加註，僅輸出譯文。",
    "5. 嚴格只輸出 JSON 陣列，格式：[{\"id\":\"...\",\"zh\":\"...\"}]，無任何前後文字、無 markdown 程式碼框。"
  ].join("\n");

  const system = [persona, styleNote, principles, rules, taiwanTermNote, glossaryBlock, customBlock]
    .filter(Boolean)
    .join("\n\n");

  const user = `輸入段落（JSON）：\n${JSON.stringify(segments)}`;

  // 拆開回傳：claude 走 --system-prompt 把 system 當系統提示、user 當對話內容；
  // codex 沒有對應旗標，會在 runCli 裡再合併成單一字串。
  return { system, user };
}

const IS_WIN = process.platform === "win32";
// Windows 可執行副檔名：npm 安裝的 CLI 通常是 .cmd（claude.cmd / codex.cmd），
// 不是裸檔名 → 找的時候要逐一補上這些副檔名。
const WIN_EXTS = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
  .split(";")
  .map((e) => e.toLowerCase())
  .filter(Boolean);

function isExecutable(p) {
  try {
    // Windows 沒有 unix 執行位元，accessSync(X_OK) 不可靠 → 存在且是檔案即可。
    if (IS_WIN) return fs.statSync(p).isFile();
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// 在某目錄裡找可執行檔：unix 直接試裸名；Windows 已含副檔名就試該名，否則逐一補 PATHEXT。
function resolveIn(dir, name) {
  if (!IS_WIN) {
    const full = path.join(dir, name);
    return isExecutable(full) ? full : null;
  }
  const candidates = path.extname(name) ? [name] : WIN_EXTS.map((e) => name + e);
  for (const c of candidates) {
    const full = path.join(dir, c);
    if (isExecutable(full)) return full;
  }
  return null;
}

// 盡量找到 CLI 執行檔：環境變數覆寫 → 穩定安裝位置 → PATH → 保底位置。
// 偵測必須可靠 — 否則「沒有 codex 時自動改用 claude」會因找不到 claude 而失敗。
function findExecutable(name) {
  const envPath = process.env[`AIYU_${name.toUpperCase()}_PATH`];
  if (envPath && isExecutable(envPath)) return envPath;

  const home = os.homedir();
  const dirs = [];

  if (IS_WIN) {
    // Windows 常見安裝位置（npm -g 的 .cmd 落在 %APPDATA%\npm）。
    const appdata = process.env.APPDATA || path.join(home, "AppData/Roaming");
    const localappdata = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
    dirs.push(
      path.join(appdata, "npm"),
      path.join(home, "scoop", "shims"),
      path.join(localappdata, "Microsoft", "WinGet", "Links"),
      "C:\\ProgramData\\chocolatey\\bin",
      path.join(home, ".bun", "bin")
    );
  } else {
    // 穩定的套件管理器安裝位置「優先於 PATH」。
    // 原因：native host 由 Chrome 啟動時 PATH 極簡 / 或 launcher 會前置各 nvm
    // node 版本的 bin（為了找到 node）。若某個舊 node 版本下殘留過時的
    // codex/claude，照 PATH 順序掃會先撞到它（實測：舊 codex 不認得
    // --ephemeral，翻譯整個失敗）。Homebrew / ~/.local 等位置由套件管理器
    // 維護、隨升級更新，比 nvm 版本 bin 可靠，故優先採用。
    dirs.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(home, ".local/bin"),
      "/usr/bin",
      "/bin"
    );
  }

  // 其次掃 PATH（用 path.delimiter 跨平台；去重避免重複檢查）
  for (const d of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    if (!dirs.includes(d)) dirs.push(d);
  }

  if (!IS_WIN) {
    // 補其他套件管理器位置
    dirs.push(
      path.join(home, ".bun/bin"),
      path.join(home, ".volta/bin"),
      path.join(home, ".deno/bin"),
      path.join(home, ".npm-global/bin"),
      path.join(home, ".npm-packages/bin"),
      path.join(home, ".local/share/pnpm"),
      path.join(home, "Library/pnpm"),
      path.join(home, ".yarn/bin")
    );
    // 最後才掃 nvm 各 node 版本的 bin —— 最容易殘留舊版，放最後當保底
    try {
      const nvmRoot = path.join(home, ".nvm/versions/node");
      for (const v of fs.readdirSync(nvmRoot)) {
        dirs.push(path.join(nvmRoot, v, "bin"));
      }
    } catch {
      /* 沒裝 nvm */
    }
  }

  for (const dir of dirs) {
    const found = resolveIn(dir, name);
    if (found) return found;
  }
  return null; // 真的找不到才回 null，不要回字面名稱
}

function detectAvailability() {
  return {
    claude: !!findExecutable("claude"),
    codex: !!findExecutable("codex"),
    agy: !!findExecutable("agy")
  };
}

function pickCli(requested) {
  const av = detectAvailability();
  if (av[requested]) return { cli: requested, fellBack: false };
  // 找其他可用
  for (const alt of ["claude", "codex", "agy"]) {
    if (alt !== requested && av[alt]) return { cli: alt, fellBack: true, from: requested };
  }
  return { cli: null, fellBack: false, error: "no CLI installed" };
}

// 從 CLI stderr 判斷是否「用量／額度上限」。
// codex 實測訊息："You've hit your usage limit. ... try again at 3:43 PM."
// claude 的確切字樣未完整確認 → 用較寬的樣式一併涵蓋（usage/rate limit、quota、429…）。
function isQuotaError(stderr) {
  return /usage limit|rate limit|quota|too many requests|\b429\b|out of credit|credit balance|insufficient_quota/i.test(
    stderr || ""
  );
}

function runCli(cli, prompt, model, context) {
  return new Promise((resolve, reject) => {
    let bin, args;
    let outFile = null; // codex 走 --output-last-message 寫檔，避免 stdout trace 污染
    let stdinPayload = null; // Windows shell 模式改走 stdin 餵 prompt，避免 cmd.exe 拆引號

    if (cli === "claude") {
      bin = findExecutable("claude");
      args = [
        "-p",
        "--tools", "",
        "--system-prompt", prompt.system,
        "--strict-mcp-config",
        "--no-session-persistence",
        "--disable-slash-commands"
      ];
      if (model) args.push("--model", model);
      args.push(prompt.user);
    } else if (cli === "codex") {
      bin = findExecutable("codex");
      outFile = path.join(
        os.tmpdir(),
        `aiyu-codex-${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2)}.txt`
      );
      args = [
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "--color", "never",
        "-c", `model_reasoning_effort=${context === "youtube" ? "low" : "medium"}`,
        "--output-last-message", outFile
      ];
      if (model) args.push("-m", model);
      args.push(`${prompt.system}\n\n${prompt.user}`);
    } else if (cli === "agy") {
      bin = findExecutable("agy");
      args = ["-p", `${prompt.system}\n\n${prompt.user}`];
    } else {
      reject(new Error(`unknown cli: ${cli}`));
      return;
    }

    const spawnT0 = Date.now();
    const promptLen = prompt.system.length + prompt.user.length;
    log("spawn", bin, "subcmd=", args[0], "model=", model || "(default)", "prompt-len=", promptLen);

    const extraPath = IS_WIN
      ? [path.join(process.env.APPDATA || path.join(os.homedir(), "AppData/Roaming"), "npm")]
      : ["/opt/homebrew/bin", "/usr/local/bin", path.join(os.homedir(), ".local/bin")];
    const env = {
      ...process.env,
      PATH: [...extraPath, process.env.PATH || ""].join(path.delimiter)
    };

    // Windows：.cmd/.bat 須經 shell 才能 spawn（否則 Node 丟 EINVAL）。但 cmd.exe 會
    // 對 argv 做 tokenization，含空白/引號/換行的長 prompt 會被拆散 → CLI 報錯。
    // 解法：把 prompt 從 argv 拔掉，改寫入 stdin（codex/claude/agy 都支援從 stdin 讀 prompt）。
    const useShell = IS_WIN && /\.(cmd|bat)$/i.test(bin || "");
    if (useShell) {
      if (cli === "codex") {
        // codex: 最後一個 positional arg 就是 prompt → 拔掉，改餵 stdin
        stdinPayload = args.pop();
      } else if (cli === "claude") {
        // claude -p: 最後一個 positional arg 是 user prompt；--system-prompt 的值也
        // 可能含特殊字元 → 一併改寫 tmpfile 再用 --system-prompt-file（未來可考慮）。
        // 但 claude -p 支援從 stdin 讀 prompt → 先拔 user prompt 就好。
        stdinPayload = args.pop();
      } else if (cli === "agy") {
        // agy -p <prompt> → 拔 prompt，改走 stdin
        stdinPayload = args.pop();
      }
    }

    const child = spawn(bin, args, {
      env,
      cwd: os.tmpdir(),
      stdio: [stdinPayload != null ? "pipe" : "ignore", "pipe", "pipe"],
      shell: useShell
    });

    if (stdinPayload != null) {
      child.stdin.write(stdinPayload);
      child.stdin.end();
    }

    let stdout = "";
    let stderr = "";
    let killed = false;

    const cleanup = () => {
      if (outFile) {
        try { fs.unlinkSync(outFile); } catch { /* ignore */ }
      }
    };

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      cleanup();
      // 有些 CLI（如 claude）達額度上限時會退避重試 → 拖到逾時。若期間 stderr
      // 已透露額度字樣，當作額度用盡回報，而非單純逾時。
      if (isQuotaError(stderr)) {
        reject(new Error(`翻譯額度用盡，請稍後再試（${cli}）`));
      } else {
        reject(new Error(`CLI timeout after ${SPAWN_TIMEOUT_MS}ms`));
      }
    }, SPAWN_TIMEOUT_MS);

    // 設定 encoding：讓 stream 內部以 StringDecoder 跨 chunk 邊界解碼 UTF-8。
    // 否則「+= d.toString('utf8')」會在多位元組字元（CJK = 3 bytes）被 data 事件
    // 切半時，把不完整片段各自解碼成 U+FFFD（�）→ 譯文出現「��」亂碼。codex 走
    // 檔案讀取（一次解碼）故無此問題；agy/claude 走串流 stdout 才會中招。
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`spawn failed: ${e.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (killed) return;
      const elapsed = ((Date.now() - spawnT0) / 1000).toFixed(1);
      if (code !== 0) {
        log("cli non-zero exit", code, "after", elapsed + "s", "stderr:", stderr.slice(0, 500));
        cleanup();
        if (isQuotaError(stderr)) {
          // 額度用盡：給乾淨、可辨識的訊息（關鍵字「額度用盡」），讓前端在影片
          // 右上角顯示專屬狀態。否則 stderr.slice(0,200) 會把 usage-limit 字樣切掉。
          reject(new Error(`翻譯額度用盡，請稍後再試（${cli}）`));
          return;
        }
        reject(new Error(`${cli} exited with code ${code}: ${stderr.slice(0, 200)}`));
        return;
      }
      log("cli done", cli, "in", elapsed + "s");
      let payload = stdout;
      if (outFile) {
        try {
          payload = fs.readFileSync(outFile, "utf8");
        } catch (e) {
          cleanup();
          reject(new Error(`讀取 codex 輸出失敗: ${e.message}`));
          return;
        }
        cleanup();
      }
      resolve(payload);
    });
  });
}

function extractJsonArray(s) {
  // 從輸出中抽出第一個 [...] 區塊，支援前後有雜訊或 ```json 包裹
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try {
      const v = JSON.parse(fenced[1]);
      if (Array.isArray(v)) return v;
    } catch {
      /* fallthrough */
    }
  }
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("找不到 JSON 陣列輸出");
  }
  return JSON.parse(s.slice(start, end + 1));
}

// ----- Message handlers -----

async function handleMessage(msg) {
  if (msg.action === "ping") {
    writeMessage({
      id: msg.id,
      result: {
        host: "aiyu-host",
        version: HOST_VERSION,
        node: process.version,
        claude: findExecutable("claude"),
        codex: findExecutable("codex"),
        agy: findExecutable("agy"),
        available: detectAvailability()
      }
    });
    return;
  }

  if (msg.action === "translate") {
    const { cli: requested = "codex", model = null, segments = [] } = msg;
    if (!Array.isArray(segments) || segments.length === 0) {
      writeMessage({ id: msg.id, error: "no segments" });
      return;
    }
    const picked = pickCli(requested);
    if (!picked.cli) {
      writeMessage({ id: msg.id, error: picked.error || "no CLI installed" });
      return;
    }
    if (picked.fellBack) {
      log("fallback", picked.from, "→", picked.cli);
    }
    // fallback 後 model 可能不適用對方 CLI（gpt-* 給 claude 會炸）→ 只在沒 fallback 時帶 model
    const effectiveModel = picked.fellBack ? null : model;
    const prompt = buildPrompt({
      target: msg.target,
      style: msg.style,
      glossary: msg.glossary,
      customPrompt: msg.customPrompt,
      segments,
      context: msg.context
    });
    try {
      const stdout = await runCli(picked.cli, prompt, effectiveModel, msg.context);
      const parsed = extractJsonArray(stdout);
      const result = parsed
        .filter((x) => x && typeof x === "object" && "id" in x && "zh" in x)
        .map((x) => ({ id: String(x.id), zh: String(x.zh) }));
      writeMessage({
        id: msg.id,
        result,
        meta: { usedCli: picked.cli, fellBack: picked.fellBack || false }
      });
    } catch (e) {
      log("translate error", e.message);
      writeMessage({ id: msg.id, error: e.message });
    }
    return;
  }

  writeMessage({ id: msg.id, error: `unknown action: ${msg.action}` });
}

log("aiyu-host started", HOST_VERSION, "node", process.version);

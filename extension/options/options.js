// 詞庫對照（對岸詞→台灣詞）的【單一來源】= ../shared/models.js（options.html 先載入，掛在 self.AIYU.DEFAULT_GLOSSARY）。

const status = document.getElementById("status");

function glossaryToText(arr) {
  return arr.map(([a, b]) => `${a}=${b}`).join("\n");
}

function textToGlossary(t) {
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const i = s.indexOf("=");
    if (i <= 0) continue;
    const a = s.slice(0, i).trim();
    const b = s.slice(i + 1).trim();
    if (a && b) out.push([a, b]);
  }
  return out;
}

// 模型清單／預設／下拉填充的單一來源 = ../shared/models.js（options.html 先載入該檔，掛在 self.AIYU）。
const { MODEL_DEFAULTS, DEFAULT_GLOSSARY, modelKey, effortKey, fillPickers, fillEffortOptions } = AIYU;

async function load() {
  const d = await chrome.storage.sync.get({
    cli: "codex",
    ...MODEL_DEFAULTS,
    customPrompt: "",
    glossary: DEFAULT_GLOSSARY,
    glossaryEnabled: false
  });
  document.getElementById("cli").value = d.cli;
  fillPickers(d.cli, d);
  document.getElementById("customPrompt").value = d.customPrompt;
  document.getElementById("glossary").value = glossaryToText(d.glossary);
  document.getElementById("glossaryEnabled").checked = d.glossaryEnabled;
}

// CLI 改變 → 即時儲存 + 重建模型／強度選項
document.getElementById("cli").addEventListener("change", async (e) => {
  const cli = e.target.value;
  await chrome.storage.sync.set({ cli });
  fillPickers(cli, await chrome.storage.sync.get(MODEL_DEFAULTS));
});

// 模型改變 → 即時儲存到對應 CLI 的 key；強度選項隨模型而變，連同畫面上的強度一起存
document.getElementById("model").addEventListener("change", (e) => {
  const cli = document.getElementById("cli").value;
  const effort = document.getElementById("effort");
  fillEffortOptions(cli, e.target.value, effort.value);
  chrome.storage.sync.set({ [modelKey(cli)]: e.target.value, [effortKey(cli)]: effort.value });
});

document.getElementById("effort").addEventListener("change", (e) => {
  chrome.storage.sync.set({ [effortKey(document.getElementById("cli").value)]: e.target.value });
});

document.getElementById("save").addEventListener("click", async () => {
  const customPrompt = document.getElementById("customPrompt").value;
  const glossary = textToGlossary(document.getElementById("glossary").value);
  const glossaryEnabled = document.getElementById("glossaryEnabled").checked;
  await chrome.storage.sync.set({ customPrompt, glossary, glossaryEnabled });
  status.textContent = glossaryEnabled
    ? `已儲存（詞庫 ${glossary.length} 條，已啟用）。`
    : "已儲存（詞庫未啟用）。";
  setTimeout(() => (status.textContent = ""), 2500);
});

document.getElementById("reset-glossary").addEventListener("click", () => {
  document.getElementById("glossary").value = glossaryToText(DEFAULT_GLOSSARY);
});

load();

const status = document.getElementById("status");

// 模型清單／預設／下拉填充的單一來源 = ../shared/models.js（popup.html 先載入該檔，掛在 self.AIYU）。
const { DEFAULT_MODEL, fillModelOptions } = AIYU;

function setStatus(text, kind = "info") {
  status.textContent = text;
  status.style.color = kind === "error" ? "#c0392b" : kind === "ok" ? "#2c8a3e" : "#666";
}

async function loadSettings() {
  const d = await chrome.storage.sync.get({
    cli: "codex",
    codexModel: DEFAULT_MODEL.codex,
    claudeModel: DEFAULT_MODEL.claude,
    target: "zh-TW",
    style: "natural"
  });
  document.getElementById("cli").value = d.cli;
  document.getElementById("target").value = d.target;
  document.getElementById("style").value = d.style;
  const curModel = d.cli === "codex" ? d.codexModel : d.claudeModel;
  fillModelOptions(d.cli, curModel);
}

async function saveSetting(key, val) {
  await chrome.storage.sync.set({ [key]: val });
}

for (const id of ["target", "style"]) {
  document.getElementById(id).addEventListener("change", (e) => {
    saveSetting(id, e.target.value);
  });
}

// CLI 改變 → 重建模型選項，並存好新 CLI
document.getElementById("cli").addEventListener("change", async (e) => {
  const cli = e.target.value;
  await saveSetting("cli", cli);
  const d = await chrome.storage.sync.get({
    codexModel: DEFAULT_MODEL.codex,
    claudeModel: DEFAULT_MODEL.claude
  });
  fillModelOptions(cli, cli === "codex" ? d.codexModel : d.claudeModel);
});

// 模型改變 → 存到對應 CLI 的 model key
document.getElementById("model").addEventListener("change", (e) => {
  const cli = document.getElementById("cli").value;
  saveSetting(cli === "codex" ? "codexModel" : "claudeModel", e.target.value);
});

document.getElementById("ping").addEventListener("click", async () => {
  setStatus("測試 host…");
  const r = await chrome.runtime.sendMessage({ type: "ping-host" });
  if (r?.ok) setStatus(`host ok (${r.info?.node || "?"})`, "ok");
  else setStatus("host 失敗：" + (r?.error || ""), "error");
});

document.getElementById("clear-cache").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "clear-cache" });
  setStatus("快取已清空", "ok");
});

document.getElementById("open-options").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

(async () => {
  await loadSettings();

  // 探測 CLI 可用性，把不可用的選項變灰；若使用者預設挑了不可用的，自動切到能用的
  try {
    const pong = await chrome.runtime.sendMessage({ type: "ping-host" });
    if (pong?.ok && pong.info?.available) {
      const av = pong.info.available;
      const cliSel = document.getElementById("cli");
      let needFix = false;
      for (const opt of cliSel.options) {
        if (!av[opt.value]) {
          opt.disabled = true;
          opt.textContent += "（未安裝）";
          if (cliSel.value === opt.value) needFix = true;
        }
      }
      if (needFix) {
        const fallback = av.codex ? "codex" : av.claude ? "claude" : av.agy ? "agy" : null;
        if (fallback) {
          cliSel.value = fallback;
          await chrome.storage.sync.set({ cli: fallback });
          const d = await chrome.storage.sync.get({
            codexModel: DEFAULT_MODEL.codex,
            claudeModel: DEFAULT_MODEL.claude
          });
          fillModelOptions(fallback, fallback === "codex" ? d.codexModel : d.claudeModel);
          setStatus(`偵測到偏好 CLI 未安裝，已切到 ${fallback}`, "ok");
        } else {
          setStatus("claude、codex、antigravity 都未安裝；請先設定 PATH 或安裝。", "error");
        }
      }
    }
  } catch {}
})();

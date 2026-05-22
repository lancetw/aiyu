const status = document.getElementById("status");

// 2026 模型清單。預設為各 CLI 最便宜的版本。
const MODELS = {
  codex: [
    { value: "gpt-5.4-mini", label: "GPT-5.4 mini（最快最省）" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex（程式專用）" },
    { value: "gpt-5.4", label: "GPT-5.4（旗艦）" },
    { value: "gpt-5.5", label: "GPT-5.5（最強）" }
  ],
  claude: [
    { value: "haiku", label: "Haiku（最快最省）" },
    { value: "sonnet", label: "Sonnet（均衡）" },
    { value: "opus", label: "Opus（最強）" }
  ]
};
const DEFAULT_MODEL = { codex: "gpt-5.4-mini", claude: "haiku" };

function fillModelOptions(cli, selected) {
  const sel = document.getElementById("model");
  const row = sel.closest("label");
  sel.replaceChildren();
  // agy 等無模型可選的後端：模型由後端自動決定 → 隱藏整列，不擺死控制項
  if (!MODELS[cli]) {
    if (row) row.style.display = "none";
    return;
  }
  if (row) row.style.display = "";
  for (const m of MODELS[cli]) {
    const opt = document.createElement("option");
    opt.value = m.value;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  sel.value = selected && MODELS[cli].some((m) => m.value === selected)
    ? selected
    : DEFAULT_MODEL[cli];
}

function setStatus(text, kind = "info") {
  status.textContent = text;
  status.style.color = kind === "error" ? "#c0392b" : kind === "ok" ? "#2c8a3e" : "#666";
}

async function loadSettings() {
  const d = await chrome.storage.sync.get({
    cli: "codex",
    codexModel: "gpt-5.4-mini",
    claudeModel: "haiku",
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
    codexModel: "gpt-5.4-mini",
    claudeModel: "haiku"
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
            codexModel: "gpt-5.4-mini",
            claudeModel: "haiku"
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

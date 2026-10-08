const status = document.getElementById("status");

// 模型清單／預設／下拉填充的單一來源 = ../shared/models.js（popup.html 先載入該檔，掛在 self.AIYU）。
const { MODEL_DEFAULTS, modelKey, effortKey, fillPickers, fillEffortOptions, hostOutdated } = AIYU;

function setStatus(text, kind = "info") {
  status.textContent = text;
  status.style.color = kind === "error" ? "#c0392b" : kind === "ok" ? "#2c8a3e" : "#666";
}

// host 版本落後擴充 → 提示更新（舊 host 不報錯，只會默默少掉新功能）
function hostStatus(info) {
  if (hostOutdated(info?.version, chrome.runtime.getManifest().version)) {
    return [`host ${info?.version || "0.5.0 以前的版本"} 需要更新：npx @lancetw/aiyu`, "error"];
  }
  return [`host ${info.version} ok (${info.node || "?"})`, "ok"];
}

async function loadSettings() {
  const d = await chrome.storage.sync.get({
    cli: "codex",
    ...MODEL_DEFAULTS,
    target: "zh-TW",
    style: "natural"
  });
  document.getElementById("cli").value = d.cli;
  document.getElementById("target").value = d.target;
  document.getElementById("style").value = d.style;
  fillPickers(d.cli, d);
}

async function saveSetting(key, val) {
  await chrome.storage.sync.set({ [key]: val });
}

for (const id of ["target", "style"]) {
  document.getElementById(id).addEventListener("change", (e) => {
    saveSetting(id, e.target.value);
  });
}

// CLI 改變 → 重建模型／強度選項，並存好新 CLI
document.getElementById("cli").addEventListener("change", async (e) => {
  const cli = e.target.value;
  await saveSetting("cli", cli);
  fillPickers(cli, await chrome.storage.sync.get(MODEL_DEFAULTS));
});

// 模型改變 → 存到對應 CLI 的 model key；強度選項隨模型而變，連同畫面上的強度一起存，免得與實際送出的不一致
document.getElementById("model").addEventListener("change", (e) => {
  const cli = document.getElementById("cli").value;
  const effort = document.getElementById("effort");
  fillEffortOptions(cli, e.target.value, effort.value);
  chrome.storage.sync.set({ [modelKey(cli)]: e.target.value, [effortKey(cli)]: effort.value });
});

document.getElementById("effort").addEventListener("change", (e) => {
  saveSetting(effortKey(document.getElementById("cli").value), e.target.value);
});

document.getElementById("ping").addEventListener("click", async () => {
  setStatus("測試 host…");
  const r = await chrome.runtime.sendMessage({ type: "ping-host" });
  if (r?.ok) setStatus(...hostStatus(r.info));
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
          fillPickers(fallback, await chrome.storage.sync.get(MODEL_DEFAULTS));
          setStatus(`偵測到偏好 CLI 未安裝，已切到 ${fallback}`, "ok");
        } else {
          setStatus("claude、codex、antigravity 都未安裝；請先設定 PATH 或安裝。", "error");
        }
      }
      // 開 popup 即檢查：過舊才提示（優先於上面的 CLI 切換訊息），版本相符就不打擾
      const [msg, kind] = hostStatus(pong.info);
      if (kind === "error") setStatus(msg, kind);
    }
  } catch {}
})();

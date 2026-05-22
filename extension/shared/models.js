// aiyu 模型設定的【單一來源】。被三處共用，避免清單／預設值各自複製而漏改：
//   - sw.js        ：classic service worker，用 importScripts("shared/models.js") 載入
//   - popup/popup.js、options/options.js：classic <script>，HTML 先載本檔再載頁面腳本
//   - node 測試     ：require 本檔（會掛到 globalThis.AIYU 並 module.exports）
// 全部走 classic 全域(self.AIYU)，故本檔不可用 import/export。
(function (root) {
  // 2026 模型清單。預設為各 CLI 最強的版本。claude 用版本字串(claude-<家族>-<版本>)以明確標示版本。
  // 版本字串(claude-haiku-4-5 / claude-sonnet-4-6 / claude-opus-4-7 / 4-6)由 claude CLI 本機 config 確認有效。
  const MODELS = {
    codex: [
      { value: "gpt-5.4-mini", label: "GPT-5.4 mini（最快最省）" },
      { value: "gpt-5.3-codex", label: "GPT-5.3 Codex（程式專用）" },
      { value: "gpt-5.4", label: "GPT-5.4（旗艦）" },
      { value: "gpt-5.5", label: "GPT-5.5（最強）" }
    ],
    claude: [
      { value: "claude-haiku-4-5", label: "Haiku 4.5（最快最省）" },
      { value: "claude-sonnet-4-6", label: "Sonnet 4.6（均衡）" },
      { value: "claude-opus-4-7", label: "Opus 4.7（最強）" },
      { value: "claude-opus-4-6", label: "Opus 4.6" }
    ]
  };
  const DEFAULT_MODEL = { codex: "gpt-5.5", claude: "claude-opus-4-7" };

  // 由設定推出實際模型：agy（Antigravity）由帳號端自動路由、print 模式無法指定 → null。
  function resolveModel(settings) {
    return settings.cli === "codex" ? settings.codexModel
      : settings.cli === "claude" ? settings.claudeModel
      : null;
  }

  // 模型字串美化：claude 版本字串(claude-opus-4-7)→「Opus 4.7」(opus/sonnet/haiku 皆含版本號)。
  // 別名(opus/sonnet/haiku)與 codex(gpt-5.5) 原樣放行。
  function prettyModel(model) {
    const m = (model || "").match(/^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/);
    if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
    return model;
  }

  // 給使用者看的「翻譯用模型」標籤：後端 · 模型（agy 由帳號端路由、無模型 → 只顯示後端名）。
  function modelLabel(cli, model) {
    const name =
      cli === "codex" ? "Codex"
      : cli === "claude" ? "Claude"
      : cli === "agy" ? "Antigravity"
      : (cli || "");
    return model ? `${name} · ${prettyModel(model)}` : name;
  }

  // 填入 #model 下拉(popup/options 共用)。agy 等無模型可選 → 隱藏整列。需要 DOM，僅在頁面端呼叫。
  function fillModelOptions(cli, selected) {
    const sel = document.getElementById("model");
    const r = sel.closest("label");
    sel.replaceChildren();
    if (!MODELS[cli]) {
      if (r) r.style.display = "none";
      return;
    }
    if (r) r.style.display = "";
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

  root.AIYU = { MODELS, DEFAULT_MODEL, resolveModel, prettyModel, modelLabel, fillModelOptions };
})(typeof self !== "undefined" ? self : globalThis);

// node 測試：require 本檔即可拿到同一份(已掛在 globalThis.AIYU)。
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof self !== "undefined" ? self : globalThis).AIYU;
}

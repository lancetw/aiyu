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

  // 對岸詞→台灣詞用詞對照：注入翻譯 system prompt，由模型理解上下文取代，不做後處理字串替換。
  // 全新安裝即套用（sw.js getSettings 的 fallback）；使用者可在進階設定覆寫。
  const DEFAULT_GLOSSARY = [
    ["軟件", "軟體"],
    ["硬件", "硬體"],
    ["代碼", "程式碼"],
    ["源碼", "原始碼"],
    ["程序", "程式"],
    ["程序員", "工程師"],
    ["函數", "函式"],
    ["數組", "陣列"],
    ["指針", "指標"],
    ["變量", "變數"],
    ["默認", "預設"],
    ["緩存", "快取"],
    ["緩衝", "緩衝"],
    ["線程", "執行緒"],
    ["進程", "行程"],
    ["接口", "介面"],
    ["協議", "通訊協定"],
    ["庫", "函式庫"],
    ["框架", "框架"],
    ["腳本", "指令稿"],
    ["命令行", "命令列"],
    ["終端", "終端機"],
    ["文件", "檔案"],
    ["文件夾", "資料夾"],
    ["菜單", "選單"],
    ["按鈕", "按鈕"],
    ["窗口", "視窗"],
    ["桌面", "桌面"],
    ["鼠標", "滑鼠"],
    ["鍵盤", "鍵盤"],
    ["屏幕", "螢幕"],
    ["顯示屏", "螢幕"],
    ["分辨率", "解析度"],
    ["像素", "像素"],
    ["打印機", "印表機"],
    ["打印", "列印"],
    ["掃描", "掃描"],
    ["U盤", "隨身碟"],
    ["硬盤", "硬碟"],
    ["內存", "記憶體"],
    ["顯卡", "顯示卡"],
    ["主板", "主機板"],
    ["處理器", "處理器"],
    ["筆記本", "筆記型電腦"],
    ["臺式機", "桌上型電腦"],
    ["服務器", "伺服器"],
    ["客戶端", "用戶端"],
    ["數據", "資料"],
    ["數據庫", "資料庫"],
    ["數據結構", "資料結構"],
    ["信息", "資訊"],
    ["消息", "訊息"],
    ["通知", "通知"],
    ["登錄", "登入"],
    ["註冊", "註冊"],
    ["賬號", "帳號"],
    ["密碼", "密碼"],
    ["驗證碼", "驗證碼"],
    ["上傳", "上傳"],
    ["下載", "下載"],
    ["鏈接", "連結"],
    ["網絡", "網路"],
    ["網站", "網站"],
    ["網頁", "網頁"],
    ["主頁", "首頁"],
    ["瀏覽器", "瀏覽器"],
    ["插件", "擴充功能"],
    ["模塊", "模組"],
    ["組件", "元件"],
    ["平臺", "平台"],
    ["項目", "專案"],
    ["版本", "版本"],
    ["發布", "發佈"],
    ["更新", "更新"],
    ["升級", "升級"],
    ["回滾", "回退"],
    ["備份", "備份"],
    ["恢復", "還原"],
    ["設置", "設定"],
    ["配置", "設定"],
    ["選項", "選項"],
    ["幫助", "說明"],
    ["教程", "教學"],
    ["指南", "指南"],
    ["示例", "範例"],
    ["演示", "示範"],
    ["截屏", "螢幕截圖"],
    ["截圖", "截圖"],
    ["視頻", "影片"],
    ["音頻", "音訊"],
    ["播放", "播放"],
    ["暫停", "暫停"],
    ["字幕", "字幕"],
    ["分辨", "辨識"],
    ["識別", "辨識"],
    ["人工智能", "人工智慧"],
    ["機器學習", "機器學習"],
    ["深度學習", "深度學習"],
    ["神經網絡", "神經網路"],
    ["模型", "模型"],
    ["訓練", "訓練"],
    ["微調", "微調"],
    ["推理", "推論"],
    ["雲計算", "雲端運算"],
    ["雲存儲", "雲端儲存"],
    ["移動端", "行動裝置"],
    ["安卓", "Android"],
    ["蘋果", "Apple"],
    ["谷歌", "Google"],
    ["微軟", "Microsoft"],
    ["臉書", "Facebook"],
    ["推特", "Twitter"],
    // — 程式開發補充 —
    ["算法", "演算法"],
    ["操作系統", "作業系統"],
    ["字符", "字元"],
    ["字符串", "字串"],
    ["異步", "非同步"],
    ["遞歸", "遞迴"],
    ["隊列", "佇列"],
    ["棧", "堆疊"],
    ["哈希", "雜湊"],
    ["布爾", "布林"],
    ["回調", "回呼"],
    ["調試", "偵錯"],
    ["報文", "封包"],
    ["數據包", "封包"],
    ["端口", "連接埠"],
    ["字節", "位元組"],
    ["比特", "位元"],
    ["帶寬", "頻寬"],
    ["集群", "叢集"],
    ["鏡像", "映像檔"],
    ["虛擬機", "虛擬機器"],
    ["負載均衡", "負載平衡"],
    ["運維", "維運"],
    ["黑客", "駭客"],
    ["補丁", "修補程式"],
    ["集成", "整合"],
    ["優化", "最佳化"],
    ["兼容", "相容"],
    ["兼容性", "相容性"],
    ["性能", "效能"],
    ["質量", "品質"],
    ["固態硬盤", "固態硬碟"],
    ["閃存", "快閃記憶體"],
    // — 操作介面補充 —
    ["用戶", "使用者"],
    ["用戶體驗", "使用者體驗"],
    ["交互", "互動"],
    ["加載", "載入"],
    ["刷新", "重新整理"],
    ["卸載", "解除安裝"],
    ["激活", "啟用"],
    ["粘貼", "貼上"],
    ["剪切", "剪下"],
    ["撤銷", "復原"],
    ["拖拽", "拖曳"],
    ["滾動", "捲動"],
    ["全屏", "全螢幕"],
    ["錄屏", "螢幕錄影"],
    ["二維碼", "QR Code"],
    // — 行動裝置與網路 —
    ["智能手機", "智慧型手機"],
    ["智能家居", "智慧家庭"],
    ["可穿戴", "穿戴式"],
    ["攝像機", "攝影機"],
    ["充電寶", "行動電源"],
    ["移動電源", "行動電源"],
    ["數據線", "傳輸線"],
    ["內存卡", "記憶卡"],
    ["寬帶", "寬頻"],
    ["信號", "訊號"],
    ["死機", "當機"],
    ["重啟", "重新啟動"],
    ["在線", "線上"],
    ["遠程", "遠端"],
    ["視頻通話", "視訊通話"],
    ["視頻會議", "視訊會議"],
    ["流媒體", "串流"],
    // — 網路文化與社群（2020 年代）—
    ["短視頻", "短影音"],
    ["博客", "部落格"],
    ["博主", "部落客"],
    ["視頻博主", "影音創作者"],
    ["表情包", "貼圖"],
    ["群聊", "群組"],
    ["點讚", "按讚"],
    ["點贊", "按讚"],
    ["私信", "私訊"],
    ["拉黑", "封鎖"],
    ["屏蔽", "封鎖"],
    ["性價比", "CP值"],
    ["外賣", "外送"],
    ["包郵", "免運"],
    ["差評", "負評"],
    ["充值", "儲值"],
    ["內卷", "內捲"],
    // — AI 時代用語（2023–2026）—
    ["大模型", "大型語言模型"],
    ["智能助手", "智慧助理"],
    ["語音助手", "語音助理"],
    ["智能體", "智慧代理"],
    ["算力", "運算力"],
    ["顯存", "顯示記憶體"],
    ["大數據", "巨量資料"],
    ["數字人", "虛擬人"],
    ["數字化", "數位化"],
    ["信息化", "資訊化"],
    ["智能化", "智慧化"]
  ];

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

  root.AIYU = { MODELS, DEFAULT_MODEL, DEFAULT_GLOSSARY, resolveModel, prettyModel, modelLabel, fillModelOptions };
})(typeof self !== "undefined" ? self : globalThis);

// node 測試：require 本檔即可拿到同一份(已掛在 globalThis.AIYU)。
if (typeof module !== "undefined" && module.exports) {
  module.exports = (typeof self !== "undefined" ? self : globalThis).AIYU;
}

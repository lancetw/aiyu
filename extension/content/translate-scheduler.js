// aiyu 翻譯排程器 — 純邏輯、無 DOM/chrome 依賴，故可被 node 測試 require。
//
// 不變量（為什麼存在）：
//   一個群組只有「拿到模型真正產出的譯文」才算 done。逾時／漏 id／空回應一律重新入列重試，
//   永不計入完成、永不無聲帶過；重試有上限，耗盡 → exhausted（仍非 done，交由前端大聲標示）。
//   失敗群組「優先」於新群組被重挑 —— 使用者正在等的破洞要盡快補上，而非排到最後。
//
// 載入方式比照 shared/models.js：content script 走全域(self)，node 測試走 require。
(function (root) {
  // 群組狀態
  var PENDING = 0, INFLIGHT = 1, DONE = 2, EXHAUSTED = 3;

  // groups: [{ start, end, idxs:[cueIndex...] }]（start/end 秒，用於依播放位置排序）
  // opts.retryCap: 每組最多嘗試幾次（含首次）才轉 exhausted
  function createScheduler(groups, opts) {
    var retryCap = (opts && opts.retryCap) || 4;
    var n = groups.length;
    var state = new Array(n).fill(PENDING);
    var attempts = new Array(n).fill(0);

    // 與舊 pickGroup 一致：正在播>前方近>已播過。回傳越小越優先。
    function positionScore(g, t) {
      var gStart = g.start;
      var gEnd = g.end || gStart + 1;
      if (t >= gStart && t < gEnd) return 0;        // 播放點就在此段內
      if (gStart >= t) return gStart - t;            // 前方 → 越近越先
      return (t - gEnd) * 3 + 100000;                // 已播過 → 大幅延後（仍會處理）
    }

    // 挑下一個要翻的群組。tier 0 = 失敗待重試（優先）、tier 1 = 全新；同 tier 內依位置。
    // 回傳群組 index；無可挑回 -1。挑中即標 inflight（另一 worker 不會重複拿）。
    function pickNext(currentTime) {
      var t = currentTime || 0;
      var best = -1, bestTier = Infinity, bestScore = Infinity;
      for (var i = 0; i < n; i++) {
        if (state[i] !== PENDING) continue;
        var tier = attempts[i] > 0 ? 0 : 1;
        var score = positionScore(groups[i], t);
        if (tier < bestTier || (tier === bestTier && score < bestScore)) {
          bestTier = tier; bestScore = score; best = i;
        }
      }
      if (best < 0) return -1;
      state[best] = INFLIGHT;
      return best;
    }

    // 回報結果。ok=true（該組所有 cue 都拿到真譯文）→ done；否則 attempts++，
    // 達上限 → exhausted，未達 → 回 pending（下次會被優先重挑）。
    function record(i, ok) {
      if (i < 0 || i >= n) return;
      if (ok) { state[i] = DONE; return; }
      attempts[i]++;
      state[i] = attempts[i] >= retryCap ? EXHAUSTED : PENDING;
    }

    // 手動重試：把 exhausted 重新變 pending、attempts 歸零。
    function reopenExhausted() {
      for (var i = 0; i < n; i++) {
        if (state[i] === EXHAUSTED) { state[i] = PENDING; attempts[i] = 0; }
      }
    }

    function status() {
      var done = 0, exhausted = 0, pending = 0, inflight = 0;
      for (var i = 0; i < n; i++) {
        if (state[i] === DONE) done++;
        else if (state[i] === EXHAUSTED) exhausted++;
        else if (state[i] === INFLIGHT) inflight++;
        else pending++;
      }
      return {
        total: n, done, exhausted, pending, inflight,
        remaining: pending + inflight,                 // 還在流程中（仍可能成功）
        allResolved: pending === 0 && inflight === 0,  // 無待處理/進行中（exhausted 視為終局）
        allDone: done === n                            // 全部拿到真譯文
      };
    }

    return {
      pickNext: pickNext,
      record: record,
      status: status,
      reopenExhausted: reopenExhausted,
      // 測試用內觀
      _state: function () { return state.slice(); },
      _attempts: function () { return attempts.slice(); }
    };
  }

  root.aiyuCreateScheduler = createScheduler;
})(typeof self !== "undefined" ? self : globalThis);

// node 測試
if (typeof module !== "undefined" && module.exports) {
  module.exports = { createScheduler: (typeof self !== "undefined" ? self : globalThis).aiyuCreateScheduler };
}

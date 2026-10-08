// 純排程器測試：encode 不變量
//   1. 失敗群組會被重新排隊重試（不是放棄）
//   2. 失敗群組「優先」於新群組被挑出
//   3. 重試有上限，耗盡 → exhausted（永遠不算 done）
//   4. 手動重試（reopenExhausted）能把 exhausted 重新變 pending
//   5. 全部拿到真譯文才 allDone
// 跑法：node test/translate-scheduler.test.js
"use strict";
const assert = require("assert");
const { createScheduler } = require("../extension/content/translate-scheduler.js");

let passed = 0;
function t(name, fn) {
  fn();
  passed++;
  console.log("  ✓ " + name);
}

// 三個群組，位置遞增（start/end 秒）。idxs 是該組涵蓋的 cue index。
function mkGroups() {
  return [
    { start: 0, end: 10, idxs: [0, 1] },
    { start: 10, end: 20, idxs: [2, 3] },
    { start: 20, end: 30, idxs: [4, 5] }
  ];
}

console.log("translate-scheduler:");

t("初始：pickNext 依播放位置挑最近的新群組", () => {
  const s = createScheduler(mkGroups(), { retryCap: 4 });
  // currentTime=12 → 第 2 組(10-20)正在播 → score 0 最優先
  assert.strictEqual(s.pickNext(12), 1);
});

t("失敗群組重新入列、且優先於新群組", () => {
  const s = createScheduler(mkGroups(), { retryCap: 4 });
  const g = s.pickNext(0); // currentTime=0 → 第 0 組(0-10) score0
  assert.strictEqual(g, 0);
  s.record(g, false);       // 第 0 組失敗 → 應回 pending、attempts=1
  // 即使 currentTime=12（第 2 組正在播、score 0），失敗的第 0 組仍應「優先」被挑出
  assert.strictEqual(s.pickNext(12), 0, "失敗群組必須優先於新群組");
});

t("重試有上限，耗盡 → exhausted，且永遠不算 done", () => {
  const s = createScheduler(mkGroups(), { retryCap: 3 });
  let g;
  for (let i = 0; i < 3; i++) {
    g = s.pickNext(0);
    assert.strictEqual(g, 0, "失敗群組應持續被優先重挑");
    s.record(g, false);
  }
  const st = s.status();
  assert.strictEqual(st.exhausted, 1, "達上限應轉 exhausted");
  assert.strictEqual(st.allDone, false, "exhausted 絕不可算完成");
  // exhausted 不再被 pickNext 挑出（除非手動 reopen）
  // 把另兩組做完，確認 allResolved=true 但 allDone=false
  s.record(s.pickNext(0), true);
  s.record(s.pickNext(0), true);
  const st2 = s.status();
  assert.strictEqual(st2.allResolved, true, "無 pending/inflight 即 allResolved");
  assert.strictEqual(st2.allDone, false, "仍有 exhausted → 不可 allDone");
});

t("手動重試：reopenExhausted 把 exhausted 變回 pending、attempts 歸零", () => {
  const s = createScheduler(mkGroups(), { retryCap: 1 });
  const g = s.pickNext(0);
  s.record(g, false); // retryCap=1 → 一次失敗即 exhausted
  assert.strictEqual(s.status().exhausted, 1);
  s.reopenExhausted();
  assert.strictEqual(s.status().exhausted, 0);
  const g2 = s.pickNext(0);
  assert.strictEqual(g2, 0, "reopen 後應可再被挑出");
  s.record(g2, true);
  assert.strictEqual(s.status().done, 1);
});

t("全部成功 → allDone", () => {
  const s = createScheduler(mkGroups(), { retryCap: 4 });
  for (let i = 0; i < 3; i++) s.record(s.pickNext(0), true);
  const st = s.status();
  assert.strictEqual(st.allDone, true);
  assert.strictEqual(st.allResolved, true);
  assert.strictEqual(s.pickNext(0), -1, "全部 done → 無可挑");
});

t("inflight 不會被另一個 worker 重複挑走", () => {
  const s = createScheduler(mkGroups(), { retryCap: 4 });
  const a = s.pickNext(0);  // worker A 拿走第 0 組 → inflight
  const b = s.pickNext(0);  // worker B 不可拿到同一組
  assert.notStrictEqual(a, b, "兩 worker 不可挑到同一組");
});

console.log("translate-scheduler: " + passed + " passed\n");

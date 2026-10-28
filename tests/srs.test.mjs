// tests/srs.test.mjs — 调度核心单测（node tests/srs.test.mjs）
import assert from "node:assert/strict";
import {
  GRADUATED_LEVEL,
  LAPSE_DELAY_MS,
  LEVEL_INTERVALS_DAYS,
  advanceDay,
  applyAnswer,
  buildQueue,
  createDay,
  dateKey,
  estimateMinutes,
  nextDue,
  pruneLog,
  streakDays
} from "../storage/srs.js";

const DAY = 24 * 60 * 60 * 1000;
// 固定「现在」：2026-10-28 11:00 本地时间，避免测试随时钟漂移
const NOW = new Date(2026, 9, 28, 11, 0, 0).getTime();

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("  ok   " + name);
  } catch (err) {
    failed += 1;
    console.error("  FAIL " + name);
    console.error("       " + (err && err.message));
  }
}

console.log("\n[srs] 间隔表");

test("level 1..7 对应 1/2/4/7/15/30/60 天", () => {
  const expected = [1, 2, 4, 7, 15, 30, 60];
  expected.forEach((days, i) => {
    assert.equal(nextDue(i + 1, NOW), NOW + days * DAY, "level " + (i + 1));
  });
  assert.deepEqual(LEVEL_INTERVALS_DAYS, expected);
});

test("level 达到毕业线后 dueAt 为 null", () => {
  assert.equal(nextDue(GRADUATED_LEVEL, NOW), null);
  assert.equal(GRADUATED_LEVEL, 8);
});

console.log("\n[srs] 作答推进");

test("新词答对：level 0 → 1，下次 1 天后", () => {
  const rec = applyAnswer(null, true, NOW);
  assert.equal(rec.level, 1);
  assert.equal(rec.dueAt, NOW + DAY);
  assert.equal(rec.reps, 1);
  assert.equal(rec.lapses, 0);
  assert.equal(rec.firstAt, NOW);
});

test("连续答对逐级递增：1 → 2 → 3，间隔 2 天 / 4 天", () => {
  const a = applyAnswer({ level: 1, dueAt: 0, reps: 1, lapses: 0, firstAt: NOW, lastAt: NOW }, true, NOW);
  assert.equal(a.level, 2);
  assert.equal(a.dueAt, NOW + 2 * DAY);
  const b = applyAnswer(a, true, NOW);
  assert.equal(b.level, 3);
  assert.equal(b.dueAt, NOW + 4 * DAY);
});

test("level 7 答对后毕业，dueAt 为 null", () => {
  const rec = applyAnswer({ level: 7, dueAt: NOW, reps: 7, lapses: 0, firstAt: 0, lastAt: NOW }, true, NOW);
  assert.equal(rec.level, GRADUATED_LEVEL);
  assert.equal(rec.dueAt, null);
});

test("答错回退两级并记 lapse，10 分钟后再出现", () => {
  const rec = applyAnswer({ level: 4, dueAt: NOW, reps: 4, lapses: 1, firstAt: 0, lastAt: NOW }, false, NOW);
  assert.equal(rec.level, 2);
  assert.equal(rec.lapses, 2);
  assert.equal(rec.dueAt, NOW + LAPSE_DELAY_MS);
  assert.equal(rec.dueAt - NOW, 10 * 60 * 1000);
});

test("低 level 答错不会变负数", () => {
  const rec = applyAnswer({ level: 1, dueAt: NOW, reps: 1, lapses: 0, firstAt: 0, lastAt: NOW }, false, NOW);
  assert.equal(rec.level, 0);
  assert.equal(applyAnswer(null, false, NOW).level, 0);
});

test("applyAnswer 不修改入参", () => {
  const prev = { level: 2, dueAt: NOW, reps: 2, lapses: 0, firstAt: 0, lastAt: 0 };
  const snapshot = JSON.stringify(prev);
  applyAnswer(prev, true, NOW);
  assert.equal(JSON.stringify(prev), snapshot);
});

console.log("\n[srs] 队列生成");

const favorites = [
  { word: "alpha", favoritedAt: 100 }, // 新词
  { word: "Beta", favoritedAt: 200 }, // 到期复习
  { word: "gamma", favoritedAt: 300 }, // 未到期
  { word: "delta", favoritedAt: 400 }, // 已掌握
  { word: "epsilon", favoritedAt: 500 } // 新词
];
const srs = {
  beta: { level: 2, dueAt: NOW - DAY },
  gamma: { level: 3, dueAt: NOW + DAY },
  delta: { level: GRADUATED_LEVEL, dueAt: null }
};

test("复习词在前（due 升序），新词在后，未到期与已掌握不进队", () => {
  const q = buildQueue({ favorites, srs, newPerDay: 10, now: NOW });
  assert.deepEqual(q, [
    { w: "beta", kind: "review" },
    { w: "alpha", kind: "new" },
    { w: "epsilon", kind: "new" }
  ]);
});

test("新词受 newPerDay 限制，按收藏时间正序取", () => {
  const q = buildQueue({ favorites, srs, newPerDay: 1, now: NOW });
  assert.deepEqual(q, [
    { w: "beta", kind: "review" },
    { w: "alpha", kind: "new" }
  ]);
});

test("收藏词去重（大小写不敏感）且过滤超长文本", () => {
  const q = buildQueue({
    favorites: [
      { word: "Alpha", favoritedAt: 1 },
      { word: "alpha", favoritedAt: 2 },
      { word: "x".repeat(40), favoritedAt: 3 }
    ],
    srs: {},
    newPerDay: 10,
    now: NOW
  });
  assert.deepEqual(q, [{ w: "alpha", kind: "new" }]);
});

test("多个到期词按 dueAt 升序排队", () => {
  const q = buildQueue({
    favorites: [
      { word: "a", favoritedAt: 1 },
      { word: "b", favoritedAt: 2 }
    ],
    srs: {
      a: { level: 1, dueAt: NOW - DAY },
      b: { level: 1, dueAt: NOW - 3 * DAY }
    },
    newPerDay: 0,
    now: NOW
  });
  assert.deepEqual(q.map((x) => x.w), ["b", "a"]);
});

console.log("\n[srs] 当日快照");

test("createDay 记录 date / total / 初始计数", () => {
  const day = createDay({ favorites, srs, newPerDay: 10, now: NOW });
  assert.equal(day.date, "2026-10-28");
  assert.equal(day.total, 3);
  assert.equal(day.known, 0);
  assert.equal(day.answers, 0);
  assert.equal(day.queue.length, 3);
});

test("答对移出队首，known +1", () => {
  const day = createDay({ favorites, srs, newPerDay: 10, now: NOW });
  const next = advanceDay(day, true, true);
  assert.equal(next.queue.length, 2);
  assert.equal(next.queue[0].w, "alpha");
  assert.equal(next.known, 1);
  assert.equal(next.unknown, 0);
});

test("答错插回队尾（requeue 开启），unknown +1，队列长度不变", () => {
  const day = createDay({ favorites, srs, newPerDay: 10, now: NOW });
  const next = advanceDay(day, false, true);
  assert.equal(next.queue.length, 3);
  assert.deepEqual(next.queue.map((x) => x.w), ["alpha", "epsilon", "beta"]);
  assert.equal(next.unknown, 1);
  assert.equal(next.known, 0);
});

test("requeue 关闭时答错直接移出", () => {
  const day = createDay({ favorites, srs, newPerDay: 10, now: NOW });
  const next = advanceDay(day, false, false);
  assert.equal(next.queue.length, 2);
  assert.equal(next.queue[0].w, "alpha");
});

test("队列只剩一个词时答错不再插回，避免死循环", () => {
  const day = { date: "2026-10-28", total: 1, queue: [{ w: "solo", kind: "new" }], answers: 0, known: 0, unknown: 0 };
  const next = advanceDay(day, false, true);
  assert.equal(next.queue.length, 0);
  assert.equal(next.unknown, 1);
});

test("空队列推进是幂等的", () => {
  const day = { date: "2026-10-28", total: 0, queue: [], answers: 0, known: 0, unknown: 0 };
  assert.deepEqual(advanceDay(day, true, true), day);
});

console.log("\n[srs] 统计");

test("连续打卡：今天 + 前两天有记录 = 3 天", () => {
  const log = {
    "2026-10-28": { known: 3, answers: 3 },
    "2026-10-27": { known: 2, answers: 4 },
    "2026-10-26": { known: 1, answers: 1 }
  };
  assert.equal(streakDays(log, NOW), 3);
});

test("今天还没背不算断，从昨天起算", () => {
  const log = {
    "2026-10-27": { known: 2, answers: 2 },
    "2026-10-26": { known: 1, answers: 1 }
  };
  assert.equal(streakDays(log, NOW), 2);
});

test("中间断一天则重新计数", () => {
  const log = {
    "2026-10-28": { known: 1, answers: 1 },
    "2026-10-26": { known: 1, answers: 1 }
  };
  assert.equal(streakDays(log, NOW), 1);
});

test("无记录返回 0", () => {
  assert.equal(streakDays({}, NOW), 0);
  assert.equal(streakDays(null, NOW), 0);
});

test("日志按 90 天截断，超期条目被丢弃", () => {
  const log = {
    "2026-07-01": { known: 1 },
    "2026-08-01": { known: 1 },
    "2026-10-28": { known: 1 }
  };
  const pruned = pruneLog(log, 90, NOW);
  assert.deepEqual(Object.keys(pruned), ["2026-08-01", "2026-10-28"]);
});

test("空日志截断不报错", () => {
  assert.deepEqual(pruneLog(null, 90, NOW), {});
});

console.log("\n[srs] 杂项");

test("dateKey 使用本地日期", () => {
  assert.equal(dateKey(NOW), "2026-10-28");
  assert.equal(dateKey(new Date(2026, 0, 5, 0, 0, 0).getTime()), "2026-01-05");
});

test("预计时长按每词 12 秒", () => {
  assert.equal(estimateMinutes(0), 1);
  assert.equal(estimateMinutes(5), 1);
  assert.equal(estimateMinutes(12), 3);
  assert.equal(estimateMinutes(38), 8);
});

console.log("\n通过 " + passed + " 项，失败 " + failed + " 项\n");
if (failed > 0) process.exit(1);

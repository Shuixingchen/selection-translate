// storage/srs.js — 背单词调度核心（纯逻辑）
// 不依赖 chrome.* API，可直接在 Node 下跑单测（见 tests/srs.test.mjs）
//
// 模型：每个单词维护一个 level（连续通过次数）
//   level 0       刚收藏，未学过
//   level 1..7    通过 1..7 次，下次间隔见 LEVEL_INTERVALS_DAYS
//   level 8       已掌握（毕业），不再进复习队列

const DAY_MS = 24 * 60 * 60 * 1000;

// level 1 → 1 天, level 2 → 2 天, ... level 7 → 60 天
export const LEVEL_INTERVALS_DAYS = [1, 2, 4, 7, 15, 30, 60];

// 通过 7 次（累计跨度约 119 天）视为掌握
export const GRADUATED_LEVEL = LEVEL_INTERVALS_DAYS.length + 1;

// 「不知道」后多久再出现（艾宾浩斯短期复习点）
export const LAPSE_DELAY_MS = 10 * 60 * 1000;

// 训练日志保留天数
export const LOG_KEEP_DAYS = 90;

export const DEFAULT_REVIEW = {
  newPerDay: 10,
  autoPlay: true,
  requeueUnknown: true
};

// ---------- 基础工具 ----------

export function normalizeWord(word) {
  return String(word == null ? "" : word).trim().toLowerCase();
}

// 本地时区的日期键 YYYY-MM-DD（跨天判定用，不能用 UTC）
export function dateKey(ts) {
  const d = new Date(ts == null ? Date.now() : ts);
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// level 对应的下一次 dueAt；已毕业返回 null
export function nextDue(level, now) {
  const ts = now == null ? Date.now() : now;
  if (!level || level < 1) return ts + LEVEL_INTERVALS_DAYS[0] * DAY_MS;
  if (level >= GRADUATED_LEVEL) return null;
  return ts + LEVEL_INTERVALS_DAYS[level - 1] * DAY_MS;
}

// 距离下次复习的天数（展示用）
export function daysUntil(dueAt, now) {
  if (!dueAt) return 0;
  const ts = now == null ? Date.now() : now;
  return Math.max(0, Math.ceil((dueAt - ts) / DAY_MS));
}

// ---------- 单次作答 ----------

// 返回新的 srs 记录（不修改入参）
export function applyAnswer(prev, knew, now) {
  const ts = now == null ? Date.now() : now;
  const base = prev || {
    level: 0,
    dueAt: 0,
    reps: 0,
    lapses: 0,
    firstAt: ts,
    lastAt: ts
  };

  if (knew) {
    const level = Math.min((base.level || 0) + 1, GRADUATED_LEVEL);
    return {
      level,
      dueAt: nextDue(level, ts),
      reps: (base.reps || 0) + 1,
      lapses: base.lapses || 0,
      firstAt: base.firstAt || ts,
      lastAt: ts
    };
  }

  // 忘记：回退两级（比归零温和），10 分钟后再出现
  const level = Math.max(0, (base.level || 0) - 2);
  return {
    level,
    dueAt: ts + LAPSE_DELAY_MS,
    reps: base.reps || 0,
    lapses: (base.lapses || 0) + 1,
    firstAt: base.firstAt || ts,
    lastAt: ts
  };
}

// ---------- 队列生成 ----------

// 从收藏词库生成当日队列：到期复习词（due 升序）+ 新词（收藏时间正序，最多 newPerDay 个）
// favorites: getFavorites() 的结果（数组，元素含 word / favoritedAt）
export function buildQueue({ favorites, srs, newPerDay, now }) {
  const ts = now == null ? Date.now() : now;
  const limit = Number.isFinite(newPerDay) ? newPerDay : DEFAULT_REVIEW.newPerDay;

  const words = (favorites || [])
    .map((c) => ({ w: normalizeWord(c && c.word), at: (c && c.favoritedAt) || 0 }))
    .filter((x) => x.w && x.w.length <= 30)
    .sort((a, b) => a.at - b.at); // 先收藏的先背

  const reviews = [];
  const news = [];
  const seen = new Set();

  for (const { w } of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    const rec = (srs || {})[w];
    if (!rec) {
      news.push({ w, kind: "new" });
      continue;
    }
    if ((rec.level || 0) >= GRADUATED_LEVEL) continue; // 已掌握，不再复习
    if ((rec.dueAt || 0) <= ts) reviews.push({ w, kind: "review", due: rec.dueAt || 0 });
  }

  reviews.sort((a, b) => a.due - b.due);
  const picked = news.slice(0, Math.max(0, limit));

  return [
    ...reviews.map(({ w, kind }) => ({ w, kind })),
    ...picked.map(({ w, kind }) => ({ w, kind }))
  ];
}

// 创建当日快照
export function createDay({ favorites, srs, newPerDay, now }) {
  const ts = now == null ? Date.now() : now;
  const queue = buildQueue({ favorites, srs, newPerDay, now: ts });
  return {
    date: dateKey(ts),
    total: queue.length,
    queue,
    answers: 0,
    known: 0,
    unknown: 0
  };
}

// ---------- 队列推进 ----------

// knew=true：队首通过，移出队列
// knew=false：移出队列；requeue 且队列还有其它词时插回队尾（队列只剩 1 个词时不再插回，避免死循环）
export function advanceDay(day, knew, requeue) {
  if (!day || !Array.isArray(day.queue) || !day.queue.length) return day;
  const [head, ...rest] = day.queue;
  const putBack = !knew && requeue && rest.length > 0;
  return {
    ...day,
    queue: putBack ? [...rest, head] : rest,
    answers: (day.answers || 0) + 1,
    known: (day.known || 0) + (knew ? 1 : 0),
    unknown: (day.unknown || 0) + (knew ? 0 : 1)
  };
}

// ---------- 统计 ----------

// 连续打卡天数：今天还没背不算断，从昨天往前数
export function streakDays(log, now) {
  const ts = now == null ? Date.now() : now;
  const active = (t) => {
    const rec = (log || {})[dateKey(t)];
    return !!rec && ((rec.known || 0) > 0 || (rec.answers || 0) > 0);
  };
  let cursor = ts;
  if (!active(cursor)) cursor -= DAY_MS;
  if (!active(cursor)) return 0;
  let count = 0;
  while (active(cursor) && count < 400) {
    count += 1;
    cursor -= DAY_MS;
  }
  return count;
}

// 保留最近 keepDays 天的日志
export function pruneLog(log, keepDays, now) {
  const days = Number.isFinite(keepDays) ? keepDays : LOG_KEEP_DAYS;
  const ts = now == null ? Date.now() : now;
  const cutoff = dateKey(ts - days * DAY_MS);
  const out = {};
  for (const k of Object.keys(log || {}).sort()) {
    if (k >= cutoff) out[k] = log[k];
  }
  return out;
}

// 预计耗时（分钟），按每词约 12 秒
export function estimateMinutes(count) {
  return Math.max(1, Math.ceil((count || 0) * 0.2));
}

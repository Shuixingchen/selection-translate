// storage/store.js — 设置 / 收藏 / 会话缓存 / 背单词进度 的统一读写封装
// 收藏、设置、背单词数据存 chrome.storage.local，翻译缓存存 chrome.storage.session（浏览器关闭即清）

import {
  DEFAULT_REVIEW,
  GRADUATED_LEVEL,
  advanceDay,
  applyAnswer,
  createDay,
  dateKey,
  estimateMinutes,
  normalizeWord,
  pruneLog,
  streakDays
} from "./srs.js";

export const DEFAULT_SETTINGS = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "",
  targetLang: "zh",
  review: { ...DEFAULT_REVIEW }
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function key(word) {
  return String(word || "").trim().toLowerCase();
}

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

// 收藏列表：按收藏时间倒序
export async function getFavorites() {
  const { favorites = {} } = await chrome.storage.local.get("favorites");
  return Object.values(favorites).sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0));
}

export async function isFavorited(word) {
  const { favorites = {} } = await chrome.storage.local.get("favorites");
  return !!favorites[key(word)];
}

// 切换收藏状态，返回切换后的状态（true=已收藏）
export async function toggleFavorite(card) {
  const k = key(card && card.word);
  if (!k) return false;
  const { favorites = {} } = await chrome.storage.local.get("favorites");
  if (favorites[k]) {
    delete favorites[k];
    await chrome.storage.local.set({ favorites });
    return false;
  }
  favorites[k] = { ...card, favoritedAt: Date.now() };
  await chrome.storage.local.set({ favorites });
  return true;
}

export async function getCacheCard(text) {
  try {
    const k = "c_" + key(text);
    const hit = (await chrome.storage.session.get(k))[k];
    if (hit && Date.now() - hit.ts < CACHE_TTL_MS) return hit.card;
  } catch (e) {
    // storage.session 不可用时静默降级为无缓存
  }
  return null;
}

export async function setCacheCard(text, card) {
  try {
    const k = "c_" + key(text);
    await chrome.storage.session.set({ [k]: { ts: Date.now(), card } });
  } catch (e) {
    // 同上，忽略
  }
}

// ---------- 背单词 ----------

function reviewSettings(settings) {
  return { ...DEFAULT_REVIEW, ...((settings && settings.review) || {}) };
}

// 取某一个收藏词条的完整卡片（背单词直接用收藏里存的卡片，不调 LLM）
export async function getFavoriteCard(word) {
  const k = normalizeWord(word);
  if (!k) return null;
  const { favorites = {} } = await chrome.storage.local.get("favorites");
  return favorites[k] || null;
}

// 当日队列：同一天直接复用快照（断点续背），跨天则重建
export async function ensureTodayQueue(now = Date.now()) {
  const { srs = {}, srsday = null, srslog = {} } = await chrome.storage.local.get([
    "srs",
    "srsday",
    "srslog"
  ]);
  if (srsday && srsday.date === dateKey(now) && Array.isArray(srsday.queue)) return srsday;

  const [favorites, settings] = await Promise.all([getFavorites(), getSettings()]);
  const { newPerDay } = reviewSettings(settings);
  const day = createDay({ favorites, srs, newPerDay, now });
  // 重建队列的同时顺手裁剪过期日志，避免无限增长
  await chrome.storage.local.set({ srsday: day, srslog: pruneLog(srslog, undefined, now) });
  return day;
}

// 提交当前词的结果：同步更新 srs 进度、当日队列、训练日志
export async function answerCurrent(knew, now = Date.now()) {
  const { srs = {}, srsday = null, srslog = {} } = await chrome.storage.local.get([
    "srs",
    "srsday",
    "srslog"
  ]);
  if (!srsday || !Array.isArray(srsday.queue) || !srsday.queue.length) {
    return { ok: false, error: "队列为空" };
  }

  const settings = await getSettings();
  const { requeueUnknown } = reviewSettings(settings);

  const word = normalizeWord(srsday.queue[0].w);
  const entry = applyAnswer(srs[word], knew, now);
  const nextSrs = { ...srs, [word]: entry };
  const nextDay = advanceDay(srsday, knew, !!requeueUnknown);

  const dk = dateKey(now);
  const prev = srslog[dk] || { answers: 0, known: 0, unknown: 0, words: [] };
  const words = Array.isArray(prev.words) ? prev.words : [];
  const nextLog = {
    ...srslog,
    [dk]: {
      answers: (prev.answers || 0) + 1,
      known: (prev.known || 0) + (knew ? 1 : 0),
      unknown: (prev.unknown || 0) + (knew ? 0 : 1),
      words: words.indexOf(word) >= 0 ? words : [...words, word]
    }
  };

  await chrome.storage.local.set({
    srs: nextSrs,
    srsday: nextDay,
    srslog: pruneLog(nextLog, undefined, now)
  });

  return {
    ok: true,
    day: nextDay,
    entry,
    word,
    level: entry.level,
    graduated: entry.level >= GRADUATED_LEVEL
  };
}

// 「再来一轮」：丢弃当日快照重新生成（已通过的词 dueAt 在未来，不会被重新选中）
export async function resetReviewDay(now = Date.now()) {
  await chrome.storage.local.remove("srsday");
  return ensureTodayQueue(now);
}

// 概览数据
export async function getReviewOverview(now = Date.now()) {
  const day = await ensureTodayQueue(now);
  const [{ srs = {}, srslog = {} }, favorites] = await Promise.all([
    chrome.storage.local.get(["srs", "srslog"]),
    getFavorites()
  ]);
  const today = srslog[dateKey(now)] || { known: 0, answers: 0, unknown: 0 };
  const due = Math.max(0, (day.total || 0) - (day.known || 0));
  const mastered = Object.values(srs).filter((r) => (r.level || 0) >= GRADUATED_LEVEL).length;

  return {
    day,
    due,
    todayKnown: today.known || 0,
    todayAnswers: today.answers || 0,
    streak: streakDays(srslog, now),
    library: favorites.length,
    mastered,
    learning: Object.keys(srs).length - mastered,
    minutes: estimateMinutes(due)
  };
}

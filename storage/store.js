// storage/store.js — 设置 / 收藏 / 会话缓存 的统一读写封装
// 收藏与设置存 chrome.storage.local，翻译缓存存 chrome.storage.session（浏览器关闭即清）

export const DEFAULT_SETTINGS = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKey: "",
  targetLang: "zh"
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

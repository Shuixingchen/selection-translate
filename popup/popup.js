// popup/popup.js — 三视图：单词表（默认）/ 单词卡详情 / Settings
import { getSettings, saveSettings, getFavorites, toggleFavorite, isFavorited } from "../storage/store.js";

// 美式读音播放图标（矢量，替代 emoji）
const SPK =
  '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">' +
  '<path d="M2.5 6.2h2.2L8 3.2v9.6L4.7 9.8H2.5z" fill="currentColor"/>' +
  '<path d="M10.3 5.7a3.2 3.2 0 0 1 0 4.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
  '<path d="M12.2 4a5.6 5.6 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
  "</svg>";

const $ = (id) => document.getElementById(id);

const views = {
  list: $("view-list"),
  card: $("view-card"),
  settings: $("view-settings")
};
const tabs = { list: $("tab-list"), settings: $("tab-settings") };
let currentCard = null;
let cardHistory = []; // 词形连查的返回栈

// ---------- 视图切换 ----------

function showView(name) {
  for (const k of Object.keys(views)) views[k].hidden = k !== name;
  tabs.list.classList.toggle("active", name === "list" || name === "card");
  tabs.settings.classList.toggle("active", name === "settings");
}

tabs.list.addEventListener("click", () => {
  renderList();
  showView("list");
});
tabs.settings.addEventListener("click", () => {
  loadSettingsForm();
  showView("settings");
});
$("card-back").addEventListener("click", async () => {
  if (cardHistory.length) {
    // 有连查历史：返回上一张卡片
    const prev = cardHistory.pop();
    currentCard = prev;
    renderCardView(prev, await isFavorited(prev.word));
  } else {
    renderList();
    showView("list");
  }
});

// ---------- 单词表 ----------

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function renderList() {
  const list = await getFavorites(); // 已按收藏时间倒序
  const ul = $("fav-list");
  const empty = $("list-empty");
  ul.innerHTML = "";
  empty.hidden = list.length > 0;
  for (const item of list) {
    const li = document.createElement("li");
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = (item.translation && item.translation[0]) || "";
    li.innerHTML = `<div class="w"></div>`;
    li.querySelector(".w").textContent = item.word;
    li.appendChild(t);
    const time = document.createElement("div");
    time.className = "time";
    time.textContent = fmtTime(item.favoritedAt);
    li.appendChild(time);
    li.addEventListener("click", () => {
      currentCard = item;
      cardHistory = [];
      renderCardView(item, true);
      showView("card");
    });
    ul.appendChild(li);
  }
}

// ---------- 输入框翻译（与划词共用 LOOKUP / 卡片视图） ----------

async function translateFromInput() {
  const text = $("translate-input").value.trim();
  if (!text) return;
  showView("card");
  $("card-body").innerHTML = '<div class="card"><div class="loading">查询中…</div></div>';
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "LOOKUP", text });
  } catch (err) {
    resp = { ok: false, error: "通信失败，请重新打开弹窗" };
  }
  if (!resp || !resp.ok) {
    const msg = (resp && (resp.message || resp.error)) || "查询失败，请重试";
    $("card-body").innerHTML = `<div class="card"><div class="loading err">${esc(msg)}</div></div>`;
    return;
  }
  currentCard = resp.card;
  renderCardView(resp.card, await isFavorited(resp.card.word));
}

$("btn-translate").addEventListener("click", translateFromInput);
$("translate-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") translateFromInput();
});

// ---------- 词形连查：点击词形直接查询该词 ----------

async function openCardByWord(word) {
  const w = String(word || "").trim();
  if (!w) return;
  if (currentCard) cardHistory.push(currentCard); // 记录当前卡片，供「返回」用
  showView("card");
  $("card-body").innerHTML = '<div class="card"><div class="loading">查询中…</div></div>';
  $("card-back").textContent = "← 返回";
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "LOOKUP", text: w });
  } catch (err) {
    resp = { ok: false, error: "通信失败，请重新打开弹窗" };
  }
  if (!resp || !resp.ok) {
    const msg = (resp && (resp.message || resp.error)) || "查询失败，请重试";
    $("card-body").innerHTML = `<div class="card"><div class="loading err">${esc(msg)}</div></div>`;
    return;
  }
  currentCard = resp.card;
  renderCardView(resp.card, await isFavorited(resp.card.word));
}

// ---------- 单词卡详情 ----------

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderCardView(card, favorited = true) {
  $("card-back").textContent = cardHistory.length ? "← 返回" : "← 返回列表";
  // >30 字符 = 翻译模式：上原文、下译文，无收藏按钮（与划词卡片一致）
  if (String(card.word || "").length > 30) {
    const translation = (card.translation || []).join("\n");
    $("card-body").innerHTML =
      `<div class="card">` +
      `<div class="trtag">翻译</div>` +
      `<div class="trsrc">${esc(card.word)}</div>` +
      `<div class="trdst">${esc(translation)}</div>` +
      `</div>`;
    return;
  }

  const phon = [];
  if (card.phonetic && card.phonetic.us) phon.push("US " + esc(card.phonetic.us));
  if (card.phonetic && card.phonetic.uk) phon.push("UK " + esc(card.phonetic.uk));
  const trans = (card.translation || []).map((t) => `<div>${esc(t)}</div>`).join("");
  const exs = (card.examples || [])
    .map((x) => `<div class="ex"><div class="en">${esc(x.en)}</div><div class="zh">${esc(x.zh)}</div></div>`)
    .join("");
  const forms = (card.forms || [])
    .map((f) => `<div class="frow"><span class="fpos">${esc(f.pos)}</span><span class="fword">${esc(f.word)}</span><button class="fspeak" data-word="${esc(f.word)}" title="播放发音" type="button">${SPK}</button><span class="fmean">${esc(f.meaning)}</span></div>`)
    .join("");

  $("card-body").innerHTML =
    `<div class="card">` +
    `<div class="head">` +
    `<span class="word">${esc(card.word)}</span>` +
    `<button class="btn speak" title="播放发音" type="button">${SPK}</button>` +
    `</div>` +
    (phon.length ? `<div class="phon">${phon.join(" · ")}</div>` : "") +
    `<div class="trans">${trans}</div>` +
    (exs ? `<div class="exs">${exs}</div>` : "") +
    (forms ? `<div class="forms"><div class="ftitle">词形变化</div>${forms}</div>` : "") +
    `<button class="unfav" type="button">取消收藏</button>` +
    `</div>`;

  $("card-body").querySelector(".speak").addEventListener("click", () => speakWord(card.word));

  $("card-body").querySelector(".unfav").textContent = favorited ? "取消收藏" : "收藏";
  $("card-body").querySelector(".unfav").classList.toggle("fav-mode", !favorited);
  $("card-body").querySelector(".unfav").addEventListener("click", async (e) => {
    const nowFavorited = await toggleFavorite(card);
    e.target.textContent = nowFavorited ? "取消收藏" : "收藏";
    e.target.classList.toggle("fav-mode", !nowFavorited);
  });

  // 词形变化：点击单词直接连查该词，点击 🔊 播放美式读音
  $("card-body").querySelectorAll(".fword").forEach((el) =>
    el.addEventListener("click", () => openCardByWord(el.textContent))
  );
  $("card-body").querySelectorAll(".fspeak").forEach((el) =>
    el.addEventListener("click", () => speakWord(el.dataset.word))
  );
}

// ---------- 发音（美式） ----------

function speakWord(word) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = "en-US";
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

// ---------- Settings ----------

async function loadSettingsForm() {
  const s = await getSettings();
  $("f-baseurl").value = s.baseUrl || "";
  $("f-model").value = s.model || "";
  $("f-apikey").value = s.apiKey || "";
  setStatus("", "");
}

function setStatus(msg, cls) {
  const el = $("settings-status");
  el.textContent = msg;
  el.className = "status " + (cls || "");
}

$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const patch = {
    baseUrl: $("f-baseurl").value.trim() || "https://api.deepseek.com",
    model: $("f-model").value.trim() || "deepseek-chat",
    apiKey: $("f-apikey").value.trim()
  };
  if (!patch.apiKey) {
    setStatus("请填写 API Key", "err");
    return;
  }
  await saveSettings(patch);
  setStatus("已保存", "ok");
});

$("btn-test").addEventListener("click", async () => {
  setStatus("测试中…", "");
  // 用表单当前值测试（不必先保存）
  const settings = {
    baseUrl: $("f-baseurl").value.trim() || "https://api.deepseek.com",
    model: $("f-model").value.trim() || "deepseek-chat",
    apiKey: $("f-apikey").value.trim()
  };
  if (!settings.apiKey) {
    setStatus("请先填写 API Key", "err");
    return;
  }
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION", settings });
  } catch (err) {
    resp = { ok: false, error: "通信失败，请重新打开弹窗" };
  }
  if (resp && resp.ok) setStatus(resp.message || "连接成功", "ok");
  else setStatus((resp && resp.error) || "连接失败", "err");
});

// ---------- 启动 ----------

renderList();
loadSettingsForm();

// popup/popup.js — 三视图：单词表（默认）/ 单词卡详情 / Settings
import { getSettings, saveSettings, getFavorites, toggleFavorite } from "../storage/store.js";

const $ = (id) => document.getElementById(id);

const views = {
  list: $("view-list"),
  card: $("view-card"),
  settings: $("view-settings")
};
const tabs = { list: $("tab-list"), settings: $("tab-settings") };
let currentCard = null;

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
$("card-back").addEventListener("click", () => {
  renderList();
  showView("list");
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
      renderCardView(item);
      showView("card");
    });
    ul.appendChild(li);
  }
}

// ---------- 单词卡详情 ----------

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderCardView(card) {
  const phon = [];
  if (card.phonetic && card.phonetic.us) phon.push("US " + esc(card.phonetic.us));
  if (card.phonetic && card.phonetic.uk) phon.push("UK " + esc(card.phonetic.uk));
  const trans = (card.translation || []).map((t) => `<div>${esc(t)}</div>`).join("");
  const exs = (card.examples || [])
    .map((x) => `<div class="ex"><div class="en">${esc(x.en)}</div><div class="zh">${esc(x.zh)}</div></div>`)
    .join("");

  $("card-body").innerHTML =
    `<div class="card">` +
    `<div class="head">` +
    `<span class="word">${esc(card.word)}</span>` +
    `<button class="btn speak" title="播放发音" type="button">🔊</button>` +
    `</div>` +
    (phon.length ? `<div class="phon">${phon.join(" · ")}</div>` : "") +
    `<div class="trans">${trans}</div>` +
    (exs ? `<div class="exs">${exs}</div>` : "") +
    `<button class="unfav" type="button">取消收藏</button>` +
    `</div>`;

  $("card-body").querySelector(".speak").addEventListener("click", () => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(card.word);
      u.lang = "en-US";
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) { /* ignore */ }
  });

  $("card-body").querySelector(".unfav").addEventListener("click", async () => {
    await toggleFavorite(card);
    renderList();
    showView("list");
  });
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

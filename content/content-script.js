// content/content-script.js — 划词检测 + 翻译小图标 + 单词卡（Shadow DOM 隔离）
// 不直接访问 chrome.storage，所有数据操作通过消息走 background

(() => {
  if (window.__wordcardLoaded) return;
  window.__wordcardLoaded = true;

  console.log("[WordCard] content script ready:", location.host);

  const host = document.createElement("div");
  host.setAttribute("data-wordcard-host", "");
  (document.documentElement || document.body).appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; margin: 0; padding: 0; }
      .wc-icon {
        position: fixed; display: none;
        width: 26px; height: 26px; border-radius: 50%;
        background: #534AB7; color: #fff;
        font: 500 13px/26px -apple-system, "Segoe UI", system-ui, sans-serif;
        text-align: center; cursor: pointer; user-select: none;
        box-shadow: 0 2px 8px rgba(20, 20, 40, 0.3);
        z-index: 2147483647;
      }
      .wc-icon:hover { background: #6a63d6; }
      .wc-card {
        position: fixed; width: 320px; max-width: calc(100vw - 16px);
        max-height: 340px; overflow-y: auto;
        background: #fff; border: 1px solid #e3e2ea; border-radius: 12px;
        padding: 14px 16px; color: #24242c;
        font: 400 13px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif;
        box-shadow: 0 8px 24px rgba(20, 20, 40, 0.16);
        z-index: 2147483647;
      }
      .wc-card[hidden] { display: none; }
      .wc-head { display: flex; align-items: center; gap: 8px; }
      .wc-word { font-size: 18px; font-weight: 600; word-break: break-word; }
      .wc-tag {
        display: inline-block; font-size: 11px; line-height: 1.6;
        color: #534AB7; background: #eeedfe; border-radius: 4px;
        padding: 0 6px; margin-bottom: 8px;
      }
      .wc-src {
        background: #f5f4f8; border-radius: 8px; padding: 8px 10px;
        font-size: 12.5px; color: #4a4952;
        white-space: pre-wrap; word-break: break-word;
      }
      .wc-dst { margin-top: 8px; font-size: 13.5px; white-space: pre-wrap; word-break: break-word; }
      .wc-btn {
        border: none; background: none; cursor: pointer; font-size: 15px;
        line-height: 1; padding: 4px; border-radius: 6px; color: #534AB7;
      }
      .wc-btn:hover { background: #eeedfe; }
      .wc-star { margin-left: auto; font-size: 18px; }
      .wc-star.on { color: #ef9f27; }
      .wc-phon { margin-top: 2px; color: #6f6e7a; font-size: 12px; }
      .wc-trans { margin-top: 8px; }
      .wc-tr { padding: 1px 0; }
      .wc-exs { margin-top: 10px; }
      .wc-ex {
        background: #f5f4f8; border-radius: 8px; padding: 8px 10px; margin-bottom: 6px;
      }
      .wc-ex .en { font-size: 12.5px; }
      .wc-ex .zh { font-size: 12px; color: #6f6e7a; margin-top: 2px; }
      .wc-forms { margin-top: 10px; border-top: 1px dashed #e3e2ea; padding-top: 8px; }
      .wc-ftitle { font-size: 11px; color: #a9a8b4; margin-bottom: 4px; }
      .wc-frow { display: flex; align-items: baseline; gap: 6px; padding: 1px 0; }
      .wc-fpos { color: #534AB7; font-size: 12px; min-width: 30px; }
      .wc-fword { color: #185FA5; cursor: pointer; font-weight: 500; }
      .wc-fword:hover { text-decoration: underline; }
      .wc-fmean { color: #6f6e7a; font-size: 12px; flex: 1; }
      .wc-state { padding: 18px 0; text-align: center; color: #6f6e7a; }
      .wc-state .spinner {
        display: inline-block; width: 14px; height: 14px; border-radius: 50%;
        border: 2px solid #d3d1e8; border-top-color: #534AB7;
        animation: wc-spin 0.8s linear infinite; margin-right: 8px; vertical-align: -2px;
      }
      @keyframes wc-spin { to { transform: rotate(360deg); } }
      .wc-error { color: #993C1D; }
    </style>
    <div class="wc-icon" title="WordCard 画词翻译">译</div>
    <div class="wc-card" hidden></div>
  `;

  const icon = shadow.querySelector(".wc-icon");
  const cardEl = shadow.querySelector(".wc-card");

  let currentText = "";
  let currentCard = null;
  let favorited = false;
  let pending = false;
  let lastRect = null;

  // ---------- 选区检测 ----------

  function selectionInfo() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
    const text = sel.toString().replace(/\s+/g, " ").trim();
    if (!text) return null; // 只要有内容就显示，不限长度
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) return null;
    return { text, rect };
  }

  function inHost(e) {
    return e.composedPath && e.composedPath().includes(host);
  }

  function isEditableTarget() {
    const ae = document.activeElement;
    return !!ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable);
  }

  document.addEventListener(
    "mouseup",
    (e) => {
      if (inHost(e) || isEditableTarget()) return;
      // 等选区稳定后再取（双击/拖选均覆盖）
      setTimeout(() => {
        const info = selectionInfo();
        if (!info) {
          hideIcon();
          return;
        }
        currentText = info.text;
        lastRect = info.rect;
        console.log("[WordCard] 鼠标划中的内容(" + info.text.length + " 字符):", info.text);
        showIcon(info.rect);
      }, 0);
    },
    true
  );

  document.addEventListener(
    "mousedown",
    (e) => {
      if (!inHost(e)) {
        hideIcon();
        hideCard();
      }
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideIcon();
      hideCard();
    }
  });

  // ---------- 图标 ----------

  function showIcon(rect) {
    console.log("[WordCard] icon shown:", currentText);
    icon.style.display = "block";
    const x = Math.min(rect.right + 6, window.innerWidth - 30);
    const y = Math.min(rect.bottom + 4, window.innerHeight - 30);
    icon.style.left = x + "px";
    icon.style.top = y + "px";
  }

  function hideIcon() {
    icon.style.display = "none";
  }

  icon.addEventListener("mousedown", (e) => e.stopPropagation());
  icon.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCard();
  });

  // ---------- 单词卡 ----------

  function hideCard() {
    cardEl.hidden = true;
    currentCard = null;
  }

  function positionCard() {
    if (!lastRect) return;
    cardEl.hidden = false;
    const h = cardEl.offsetHeight || 160;
    let top = lastRect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, lastRect.top - h - 8);
    const left = Math.max(8, Math.min(lastRect.left, window.innerWidth - cardEl.offsetWidth - 8));
    cardEl.style.top = top + "px";
    cardEl.style.left = left + "px";
  }

  async function openCard(textOverride) {
    const text = String(textOverride || currentText || "").trim();
    if (!text || pending) return;
    currentText = text;
    pending = true;
    hideIcon();
    cardEl.innerHTML = '<div class="wc-state"><span class="spinner"></span>查询中…</div>';
    positionCard();
    try {
      const resp = await chrome.runtime.sendMessage({ type: "LOOKUP", text: text });
      if (!resp || !resp.ok) {
        renderError((resp && (resp.message || resp.error)) || "查询失败，请重试");
        return;
      }
      currentCard = resp.card;
      renderCard(resp.card);
      const fav = await chrome.runtime.sendMessage({ type: "IS_FAVORITED", word: resp.card.word });
      favorited = !!(fav && fav.ok && fav.favorited);
      updateStar();
    } catch (err) {
      renderError("插件通信失败，请刷新页面后重试");
    } finally {
      pending = false;
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function renderCard(card) {
    // >30 字符 = 翻译模式：上原文、下译文，无收藏
    if (String(card.word || "").length > 30) {
      renderTranslationCard(card);
      return;
    }
    const phon = [];
    if (card.phonetic && card.phonetic.us) phon.push("US " + esc(card.phonetic.us));
    if (card.phonetic && card.phonetic.uk) phon.push("UK " + esc(card.phonetic.uk));
    const trans = (card.translation || []).map((t) => '<div class="wc-tr">' + esc(t) + "</div>").join("");
    const exs = (card.examples || [])
      .map((x) => '<div class="wc-ex"><div class="en">' + esc(x.en) + '</div><div class="zh">' + esc(x.zh) + "</div></div>")
      .join("");
    const forms = (card.forms || [])
      .map((f) =>
        '<div class="wc-frow"><span class="wc-fpos">' + esc(f.pos) + "</span>" +
        '<span class="wc-fword" data-word="' + esc(f.word) + '">' + esc(f.word) + "</span>" +
        '<span class="wc-fmean">' + esc(f.meaning) + "</span></div>"
      )
      .join("");

    cardEl.innerHTML =
      '<div class="wc-head">' +
      '<span class="wc-word">' + esc(card.word) + "</span>" +
      '<button class="wc-btn wc-speak" title="播放发音">🔊</button>' +
      '<button class="wc-btn wc-star" title="收藏 / 取消收藏">☆</button>' +
      "</div>" +
      (phon.length ? '<div class="wc-phon">' + phon.join(" · ") + "</div>" : "") +
      '<div class="wc-trans">' + trans + "</div>" +
      (exs ? '<div class="wc-exs">' + exs + "</div>" : "") +
      (forms ? '<div class="wc-forms"><div class="wc-ftitle">词形变化（点击可查询）</div>' + forms + "</div>" : "");

    cardEl.querySelector(".wc-speak").addEventListener("click", () => speak(card.word));
    cardEl.querySelector(".wc-star").addEventListener("click", toggleStar);
    cardEl.querySelectorAll(".wc-fword").forEach((el) =>
      el.addEventListener("click", () => openCard(el.dataset.word))
    );
    positionCard();
  }

  function renderError(message) {
    cardEl.innerHTML = '<div class="wc-state wc-error">' + esc(message) + "</div>";
    positionCard();
  }

  // 翻译模式卡片：上面原文，下面译文，无收藏按钮
  function renderTranslationCard(card) {
    const translation = (card.translation || []).join("\n");
    cardEl.innerHTML =
      '<div class="wc-tag">翻译</div>' +
      '<div class="wc-src">' + esc(card.word) + "</div>" +
      '<div class="wc-dst">' + esc(translation) + "</div>";
    positionCard();
  }

  function updateStar() {
    const star = cardEl.querySelector(".wc-star");
    if (!star) return;
    star.textContent = favorited ? "★" : "☆";
    star.classList.toggle("on", favorited);
    star.title = favorited ? "取消收藏" : "收藏";
  }

  async function toggleStar() {
    if (!currentCard) return;
    const prev = favorited;
    favorited = !favorited; // 乐观更新
    updateStar();
    try {
      const resp = await chrome.runtime.sendMessage({ type: "TOGGLE_FAVORITE", card: currentCard });
      if (resp && resp.ok) favorited = !!resp.favorited;
    } catch (err) {
      favorited = prev; // 失败回滚
    }
    updateStar();
  }

  function speak(word) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(word);
      u.lang = "en-US";
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch (e) {
      // 当前页面不支持 TTS 时静默
    }
  }
})();

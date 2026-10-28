// review/review-view.js — 背单词复习卡（两段式：词面 / 遮罩译文）
// 视图自身不碰 chrome.storage，全部通过注入的回调读写，便于复用与测试

const SPK =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">' +
  '<path d="M2.5 6.2h2.2L8 3.2v9.6L4.7 9.8H2.5z" fill="currentColor"/>' +
  '<path d="M10.3 5.7a3.2 3.2 0 0 1 0 4.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
  '<path d="M12.2 4a5.6 5.6 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' +
  "</svg>";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

export function createReviewView(root, options) {
  const opts = options || {};
  const getCard = opts.getCard || (async () => null);
  const answer = opts.answer || (async () => ({ ok: true }));
  const speak = opts.speak;
  const onComplete = opts.onComplete;
  const onExit = opts.onExit;
  const autoPlay = opts.autoPlay !== false;

  let day = null;
  let card = null;
  let revealed = false;
  let busy = false;

  // ---------- 数据流 ----------

  async function start(initialDay) {
    day = initialDay;
    await loadHead();
  }

  async function loadHead() {
    if (!day || !Array.isArray(day.queue) || !day.queue.length) {
      if (typeof onComplete === "function") onComplete(day);
      return;
    }
    revealed = false;
    busy = true;
    try {
      card = await getCard(day.queue[0].w);
    } catch (e) {
      card = null;
    }
    busy = false;
    render();
    if (autoPlay && card && typeof speak === "function") speak(card.word);
  }

  async function submit(knew) {
    if (busy || !day) return null;
    busy = true;
    let res = null;
    try {
      res = await answer(knew);
    } catch (e) {
      res = null;
    }
    busy = false;
    if (res && res.day) day = res.day;
    return res;
  }

  async function handleKnow() {
    await submit(true);
    await loadHead();
  }

  async function handleUnknown() {
    await submit(false);
    revealed = true; // 当前卡片保留，只是揭开答案
    render();
  }

  async function handleNext() {
    await loadHead();
  }

  // ---------- 渲染 ----------

  function render() {
    if (!card) {
      root.innerHTML =
        '<div class="rv">' +
        '<div class="rv-missing">该词条已不在收藏中<div class="rv-actions">' +
        '<button class="rv-btn rv-know" data-act="next" type="button">跳过</button>' +
        "</div></div></div>";
      bind();
      return;
    }

    const total = (day && day.total) || 0;
    const known = (day && day.known) || 0;
    const pct = total ? Math.round((known / total) * 100) : 0;

    const phon = card.phonetic && card.phonetic.us ? card.phonetic.us : "";
    const trans = (card.translation || []).map((t) => "<div>" + esc(t) + "</div>").join("");
    const exs = (card.examples || [])
      .map(
        (x) =>
          '<div class="rv-ex"><div class="en">' + esc(x.en) + "</div>" +
          (x.zh ? '<div class="zh">' + esc(x.zh) + "</div>" : "") +
          "</div>"
      )
      .join("");
    const forms = (card.forms || [])
      .map(
        (f) =>
          '<div class="rv-frow"><span class="rv-fpos">' + esc(f.pos) + "</span>" +
          '<span class="rv-fword">' + esc(f.word) + "</span>" +
          '<span class="rv-fmean">' + esc(f.meaning) + "</span></div>"
      )
      .join("");

    root.innerHTML =
      '<div class="rv">' +
      '<div class="rv-top">' +
      '<div class="rv-bar"><i style="width:' + pct + '%"></i></div>' +
      '<span class="rv-count">' + known + " / " + total + "</span>" +
      '<button class="rv-exit" data-act="exit" type="button" title="退出（进度已保存）">×</button>' +
      "</div>" +

      '<div class="rv-card">' +
      '<div class="rv-word">' + esc(card.word) + "</div>" +
      '<div class="rv-phon">' + (phon ? "US " + esc(phon) : "") + "</div>" +
      '<button class="rv-speak" data-act="speak" type="button">' + SPK + "<span>播放</span></button>" +
      '<div class="rv-divider"></div>' +

      '<div class="rv-answer">' +
      '<div class="rv-body' + (revealed ? "" : " rv-blur") + '">' +
      (trans ? '<div class="rv-trans">' + trans + "</div>" : "") +
      exs +
      (forms ? '<div class="rv-forms"><div class="rv-ft">词形变化</div>' + forms + "</div>" : "") +
      "</div>" +
      (revealed ? "" : '<div class="rv-cover"><div class="rv-cover-t">先回想一下</div><div class="rv-cover-s">点「不知道」查看释义</div></div>') +
      "</div>" +
      "</div>" +

      '<div class="rv-actions">' +
      (revealed
        ? '<button class="rv-btn rv-primary" data-act="next" type="button">next</button>'
        : '<button class="rv-btn rv-unknown" data-act="unknown" type="button">不知道</button>' +
          '<button class="rv-btn rv-know" data-act="know" type="button">知道</button>') +
      "</div>" +
      "</div>";

    bind();
  }

  function bind() {
    const wire = (act, fn) => {
      const el = root.querySelector('[data-act="' + act + '"]');
      if (!el) return;
      el.addEventListener("click", (e) => {
        e.currentTarget.blur(); // 让键盘快捷键在点击后依然可用
        fn();
      });
    };
    wire("know", handleKnow);
    wire("unknown", handleUnknown);
    wire("next", handleNext);
    wire("speak", () => card && typeof speak === "function" && speak(card.word));
    wire("exit", () => typeof onExit === "function" && onExit());
  }

  // ---------- 键盘 ----------

  function onKey(e) {
    if (!root.isConnected || root.closest("[hidden]")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "1") {
      e.preventDefault();
      handleKnow();
    } else if (e.key === "2") {
      e.preventDefault();
      handleUnknown();
    } else if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      if (revealed) handleNext();
      else handleUnknown();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (typeof onExit === "function") onExit();
    }
  }

  document.addEventListener("keydown", onKey);

  return {
    start,
    destroy() {
      document.removeEventListener("keydown", onKey);
      root.innerHTML = "";
    },
    getDay() {
      return day;
    }
  };
}

// 完成页（由 popup.js 在 onComplete 里调用）
export function renderReviewDone(root, day) {
  const total = (day && day.total) || 0;
  const known = (day && day.known) || 0;
  const answers = (day && day.answers) || 0;
  const rate = answers ? Math.round((known / answers) * 100) : 0;

  root.innerHTML =
    '<div class="rv rv-done">' +
    '<div class="rv-done-num">' + known + "</div>" +
    '<div class="rv-done-lbl">本轮通过 ' + total + " 个单词</div>" +
    '<div class="rv-done-meta">正确率 ' + rate + "%" + (total ? "" : " · 今天没有待背的词") + "</div>" +
    '<div class="rv-actions">' +
    '<button class="rv-btn rv-primary" data-act="again" type="button">再来一轮</button>' +
    '<button class="rv-btn" data-act="back" type="button">返回</button>' +
    "</div></div>";

  return {
    onAgain(fn) {
      const el = root.querySelector('[data-act="again"]');
      if (el) el.addEventListener("click", fn);
    },
    onBack(fn) {
      const el = root.querySelector('[data-act="back"]');
      if (el) el.addEventListener("click", fn);
    }
  };
}

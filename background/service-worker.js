// background/service-worker.js — 消息路由 + LLM 调用 + 缓存
// content script 与 popup 的所有请求统一走这里（跨域 fetch 需要 host_permissions）

import { translate, testConnection } from "../providers/deepseek.js";
import {
  getSettings,
  getCacheCard,
  setCacheCard,
  isFavorited,
  toggleFavorite
} from "../storage/store.js";

const MAX_TEXT = 2000; // 防御性上限（整页 Ctrl+A 全选等极端情况）

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[WordCard][bg] 收到消息:", msg && msg.type, msg && msg.text !== undefined ? "| text: " + JSON.stringify(String(msg.text).slice(0, 100)) : "");
  handleMessage(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: (err && err.message) || String(err) }));
  return true; // 异步响应
});

async function handleMessage(msg) {
  switch (msg && msg.type) {
    case "LOOKUP": {
      const text = String(msg.text || "").trim().slice(0, MAX_TEXT);
      if (!text) return { ok: false, error: "未选中有效文本" };

      console.log("[WordCard][bg] LOOKUP 查询内容(" + text.length + " 字符):", text);

      const cached = await getCacheCard(text);
      if (cached) {
        console.log("[WordCard][bg] 缓存命中，不调用大模型:", JSON.stringify(cached));
        return { ok: true, card: cached, cached: true };
      }
      console.log("[WordCard][bg] 缓存未命中，准备调用大模型…");

      const settings = await getSettings();
      console.log("[WordCard][bg] 当前配置: provider=" + settings.provider + ", model=" + settings.model + ", baseUrl=" + settings.baseUrl + ", apiKey=" + (settings.apiKey ? settings.apiKey.slice(0, 6) + "***" : "(未配置)"));
      if (!settings.apiKey) {
        console.warn("[WordCard][bg] 未配置 API Key，翻译中止");
        return {
          ok: false,
          code: "NO_KEY",
          error: "尚未配置 API Key",
          message: "点击浏览器右上角 WordCard 插件图标 → Settings，填写 DeepSeek API Key 后保存"
        };
      }
      const card = await translate(text, settings); // 失败会 throw，由外层统一捕获
      console.log("[WordCard][bg] 大模型返回单词卡:", JSON.stringify(card));
      await setCacheCard(text, card);
      return { ok: true, card };
    }

    case "IS_FAVORITED": {
      return { ok: true, favorited: await isFavorited(msg.word) };
    }

    case "TOGGLE_FAVORITE": {
      return { ok: true, favorited: await toggleFavorite(msg.card) };
    }

    case "TEST_CONNECTION": {
      const settings = msg.settings || (await getSettings());
      return await testConnection(settings);
    }

    default:
      return { ok: false, error: "未知消息类型" };
  }
}

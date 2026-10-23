// providers/deepseek.js — DeepSeek（OpenAI 兼容）适配器
// 后续接入其他大模型时，实现同签名的 translate(text, settings) 即可

const SYSTEM_PROMPT = [
  "You are a translation engine for a browser extension.",
  "The user selects an English word, phrase, or sentence.",
  "Reply with STRICT JSON only (no markdown, no extra text) matching this schema:",
  '{"word":"...","phonetic":{"us":"...","uk":"..."},"translation":["..."],"examples":[{"en":"...","zh":"..."},...],"forms":[{"pos":"v.","word":"...","meaning":"..."},...]}',
  "Rules:",
  "- The input may be any language. If it is English, translate into Simplified Chinese as described below. If it is Chinese (or another language), translate into natural English using the same schema.",
  "- If the input is a word or short phrase: translation = 1-4 dictionary-style entries in the target language, each with part of speech like \"v. 谈判，协商\"; examples = exactly 2 natural sentences; phonetic = IPA with slashes like \"/nɪˈɡoʊʃieɪt/\" (only for English input).",
  "- If the input is a sentence: translation = exactly 1 entry, the complete translation of the sentence (no part of speech); examples = empty array []; phonetic = empty strings.",
  "- If the input is a single English word: forms = 2-6 related word forms and derivations (noun/verb/adjective/adverb variants, e.g. redemption -> redeem (v.), redemptive (adj.), redeemable (adj.)), each item {\"pos\":\"n.|v.|adj.|adv.\",\"word\":\"...\",\"meaning\":\"brief Simplified Chinese meaning\"}. Use empty array [] for sentences, phrases, or non-English input.",
  "- word: the looked-up text itself.",
  "The output must be valid json."
].join("\n");

export async function translate(text, settings) {
  const base = String(settings.baseUrl || "").replace(/\/+$/, "");
  if (!settings.apiKey) {
    const err = new Error("NO_KEY");
    err.code = "NO_KEY";
    throw err;
  }
  const body = {
    model: settings.model || "deepseek-chat",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: String(text).slice(0, 2000) }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 1200
  };
  console.log("[WordCard][LLM] >>> 调用大模型:", base + "/chat/completions");
  console.log("[WordCard][LLM] >>> 请求体:", JSON.stringify(body, null, 2));
  let res;
  try {
    res = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.apiKey
      },
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.error("[WordCard][LLM] <<< 网络请求失败:", e && e.message);
    const err = new Error("网络请求失败，请检查网络或 Base URL");
    err.code = "NETWORK";
    throw err;
  }

  console.log("[WordCard][LLM] <<< HTTP 状态:", res.status);

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("[WordCard][LLM] <<< 错误响应:", errText.slice(0, 500));
    const err = new Error(httpErrorMessage(res.status));
    err.code = "HTTP_" + res.status;
    throw err;
  }

  const data = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  console.log("[WordCard][LLM] <<< 模型输出:", content);
  console.log("[WordCard][LLM] <<< token 用量:", JSON.stringify(data.usage || {}));
  if (!content) {
    const err = new Error("模型返回为空");
    err.code = "EMPTY";
    throw err;
  }
  let raw;
  try {
    raw = JSON.parse(content);
  } catch (e) {
    const err = new Error("模型返回格式异常，请重试");
    err.code = "BAD_JSON";
    throw err;
  }
  return normalizeCard(raw, text);
}

export async function testConnection(settings) {
  const base = String(settings.baseUrl || "").replace(/\/+$/, "");
  if (!settings.apiKey) {
    return { ok: false, error: "未填写 API Key" };
  }
  try {
    const res = await fetch(base + "/models", {
      headers: { Authorization: "Bearer " + settings.apiKey }
    });
    if (!res.ok) return { ok: false, error: httpErrorMessage(res.status) };
    const data = await res.json();
    const models = (data.data || []).map((m) => m.id).join(", ");
    return { ok: true, message: "连接成功" + (models ? "，可用模型：" + models : "") };
  } catch (e) {
    return { ok: false, error: "连接失败，请检查网络或 Base URL" };
  }
}

function httpErrorMessage(status) {
  switch (status) {
    case 401: return "API Key 无效（401）";
    case 402: return "账户余额不足（402）";
    case 422: return "请求参数错误（422），请检查模型名";
    case 429: return "请求过于频繁（429），请稍后重试";
    case 500:
    case 503: return "DeepSeek 服务暂不可用（" + status + "）";
    default: return "请求失败（HTTP " + status + "）";
  }
}

// 校验并规整模型输出，保证下游拿到的结构稳定
function normalizeCard(raw, fallbackText) {
  const card = {
    word: typeof raw.word === "string" && raw.word.trim() ? raw.word.trim() : String(fallbackText).trim(),
    phonetic: {
      us: str(raw, ["phonetic", "us"]),
      uk: str(raw, ["phonetic", "uk"])
    },
    translation: [],
    examples: []
  };
  if (Array.isArray(raw.translation)) {
    card.translation = raw.translation.filter((t) => typeof t === "string" && t.trim()).slice(0, 4);
  }
  if (Array.isArray(raw.examples)) {
    card.examples = raw.examples
      .filter((x) => x && typeof x.en === "string" && x.en.trim())
      .map((x) => ({ en: x.en.trim(), zh: typeof x.zh === "string" ? x.zh.trim() : "" }))
      .slice(0, 2);
  }
  card.forms = [];
  if (Array.isArray(raw.forms)) {
    card.forms = raw.forms
      .filter((f) => f && typeof f.word === "string" && f.word.trim())
      .map((f) => ({
        pos: typeof f.pos === "string" ? f.pos.trim() : "",
        word: f.word.trim(),
        meaning: typeof f.meaning === "string" ? f.meaning.trim() : ""
      }))
      .slice(0, 6);
  }
  if (!card.translation.length) {
    card.translation = ["（未获取到释义，请重试）"];
  }
  return card;
}

function str(obj, path) {
  let v = obj;
  for (const p of path) {
    if (v == null || typeof v !== "object") return "";
    v = v[p];
  }
  return typeof v === "string" ? v.trim() : "";
}

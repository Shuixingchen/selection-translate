# 画词翻译 Chrome 插件 — 项目规划

> 项目代号：**WordCard**（画词翻译）
> 目录：`/Users/csx/code/selection-translate/`
> 状态：**v0.1.0 已实现**（M1–M4 全部落地，待浏览器实测）
> 日期：2026-10-22（规划）/ 2026-10-22（v0.1.0 实现）

---

## 1. 产品定义

划词翻译插件：鼠标选中页面文字 → 旁边浮出翻译小图标 → 点击图标弹出**单词卡**。

单词卡内容：

| 区块 | 说明 |
|---|---|
| 单词 | 选中的原文 |
| 读音 | 点击可播放发音（浏览器内置 TTS，免费无需 key） |
| 音标 | 美 /nɪˈɡoʊʃieɪt/ · 英 /nɪˈɡəʊʃieɪt/ |
| 中文解释 | 词性 + 释义（多条） |
| 例句 | 英文例句 + 中文翻译（2 条） |
| 收藏按钮 | ⭐ 收藏 / 取消收藏，存本地 |

翻译能力由大模型提供，首个适配 **DeepSeek API**（OpenAI 兼容格式，后续可扩展其他模型）。插件自带配置页，用户填入自己的 API Key。

---

## 2. 技术选型

| 项 | 选型 | 理由 |
|---|---|---|
| 插件标准 | **Manifest V3** | Chrome 当前强制标准，V2 已淘汰 |
| 前端 | **原生 JS + CSS，无构建** | MVP 最快路径，`chrome://extensions` 加载即用，无需 npm/打包；后续要扩展再迁 Vite+TS |
| 卡片 UI | **Shadow DOM** | 隔离宿主页面 CSS，避免样式污染与被宿主页覆盖 |
| LLM 调用 | **background Service Worker** 统一代理 | MV3 下 content script 受 CORS 限制，跨域请求必须走 background；且便于统一限流/缓存 |
| LLM 适配 | **Provider 抽象层** | 定义统一接口 `translate(text) → WordCard`，先实现 `DeepSeekAdapter`，后续加 OpenAI / Claude / Gemini 只需新增 adapter |
| 本地存储 | **chrome.storage.local** | MVP 阶段充当本地数据库（设置 + 收藏列表），API 简单、可直接在 options 页管理；数据量大后再升级 IndexedDB |
| 发音 | **Web Speech API（speechSynthesis）** | 浏览器内置，零成本零依赖；后续可换真人发音源 |

---

## 3. 目录结构（规划）

```
selection-translate/
├── PLAN.md                  # 本文档
├── manifest.json            # MV3 清单
├── background/
│   └── service-worker.js    # 消息路由 + LLM 调用 + 缓存
├── content/
│   ├── content-script.js    # 划词检测、图标定位、卡片挂载
│   ├── card.html.js         # 单词卡模板（Shadow DOM 内）
│   └── card.css             # 卡片样式
├── providers/
│   ├── provider.js          # LLM Provider 接口定义
│   └── deepseek.js          # DeepSeek 适配器
├── storage/
│   └── store.js             # 收藏/设置/缓存的读写封装
├── options/
│   ├── options.html         # 配置页（API Key、模型、测试连接）
│   ├── options.js
│   └── options.css
└── popup/                   # （M4）点击插件图标的收藏列表弹窗
    ├── popup.html
    ├── popup.js
    └── popup.css
```

---

## 4. 核心模块设计

### 4.1 Content Script（划词 + 图标 + 单词卡）

- 监听 `mouseup` / `selectionchange`，检测有效选区（非空、非密码框、非 input/textarea 也可支持）
- 选区旁渲染小图标（绝对定位，跟随选区坐标，自动防出屏）
- 点击图标 → 在图标下方弹出单词卡（Shadow DOM 隔离）
- 点空白处 / Esc → 关闭卡片
- 卡片不选中页面文字（`user-select: none`），避免误触发

### 4.2 Background Service Worker（API 代理）

- 接收 content script 消息：`{ type: "LOOKUP", text: "..." }`
- 查缓存 → 无缓存则调 LLM → 返回结构化 WordCard JSON
- **先查缓存**（chrome.storage.session），同一词 24h 内不重复扣 token
- 统一错误处理：401（key 错）、429（限流）、超时，返回友好错误信息给卡片展示

### 4.3 DeepSeek 适配器

- Endpoint：`POST https://api.deepseek.com/chat/completions`（OpenAI 兼容）
- Model：`deepseek-chat`（可在配置页改）
- 用 `response_format: { "type": "json_object" }` 强制 JSON 输出
- Prompt 设计：要求模型只输出固定 schema 的 JSON（见 §5），目标语言中文

### 4.4 Options 配置页

| 配置项 | 默认值 |
|---|---|
| API Key | 空（密码框，掩码显示） |
| Base URL | `https://api.deepseek.com` |
| 模型 | `deepseek-chat` |
| 目标语言 | 中文 |
| **测试连接** 按钮 | 发一条最小请求验证 key 有效性 |

### 4.5 收藏功能与 Popup 页面（已确认结构，共 4 个页面）

**页面 1 · 单词卡（content script，划词触发）**
选中文字 → 图标 → 弹出单词卡：单词、美/英音标、🔊 读音、中文释义、双语例句、⭐ 收藏切换。

**页面 2 · Popup 默认页（点击浏览器工具栏插件图标）**
顶部两个入口按钮：`单词表` / `Settings`，默认展示单词表。

**页面 3 · 单词表**
- 收藏列表按**收藏时间倒序**，一行一个：单词 + 首条释义 + 收藏时间
- 点击某行 → 进入该词的单词卡页面（含 🔊 读音、`取消收藏` 按钮）
- 空列表显示引导文案

**页面 4 · Settings**
- 表单：Base URL（默认 `https://api.deepseek.com`）、Model（`deepseek-chat` / `deepseek-reasoner` 可选填）、API Key（密码框）
- 打开时**自动回显**已保存值；`保存` 按钮写入 chrome.storage.local
- `测试连接` 按钮用表单当前值调 `GET /models` 验证 Key（不消耗 token）
- 底部注明：Key 仅存本地，不上传任何服务器

收藏数据流：卡片 ⭐ 切换 → background 消息 → `chrome.storage.local`（按单词去重，同词更新时间戳）。

---

## 5. 数据结构定义

**WordCard（LLM 输出 schema，同时是收藏项）：**

```json
{
  "word": "negotiate",
  "phonetic": {
    "us": "/nɪˈɡoʊʃieɪt/",
    "uk": "/nɪˈɡəʊʃieɪt/"
  },
  "translation": [
    "v. 谈判，协商",
    "v. 谈成，议定"
  ],
  "examples": [
    { "en": "The two sides agreed to negotiate a settlement.", "zh": "双方同意通过谈判解决争端。" }
  ],
  "forms": [
    { "pos": "n.", "word": "negotiation", "meaning": "谈判，协商" },
    { "pos": "adj.", "word": "negotiable", "meaning": "可协商的" }
  ],
  "lookedUpAt": 1760000000000
}
```

**Settings：**

```json
{
  "provider": "deepseek",
  "apiKey": "sk-***",
  "baseUrl": "https://api.deepseek.com",
  "model": "deepseek-chat",
  "targetLang": "zh"
}
```

**缓存（session）：** `cache: { "negotiate": { card: {...}, ts: ... } }`

---

## 6. 端到端流程

```
用户划词 → content script 检测选区 → 浮出小图标
→ 点击图标 → 发消息 LOOKUP → background
→ 查缓存命中？──是──→ 返回卡片数据
                  └─否→ DeepSeekAdapter 调 API（JSON mode）→ 校验+入库缓存 → 返回
→ content script 渲染单词卡（Shadow DOM）
→ 用户点 🔊 播发音（speechSynthesis）/ 点 ⭐ 切换收藏（chrome.storage.local）
```

---

## 7. 关键技术风险与对策

| 风险 | 对策 |
|---|---|
| LLM 返回的 JSON 不合规 | schema 校验 + 失败自动重试 1 次 + 卡片显示错误态 |
| MV3 service worker 随时休眠 | 无状态设计，所有状态放 storage；消息唤醒 |
| 宿主页面样式冲突 / CSP 限制 | Shadow DOM + 不注入远程资源 |
| 图标遮挡页面交互 / iframe 内不生效 | 图标 pointer-events 精确控制；iframe 场景 MVP 暂不支持（记录为已知限制） |
| API Key 安全 | 仅存本地 chrome.storage，不上传任何远端 |

---

## 8. 开发里程碑（小步迭代）

| 阶段 | 交付 | 验收标准 | 状态 |
|---|---|---|---|
| **M1 骨架** | manifest + 划词检测 + 小图标 | chrome://extensions 加载后，任意网页划词出现图标，点空白消失 | ✅ v0.1.0 |
| **M2 单词卡** | Shadow DOM 卡片 + 发音 | 点图标弹完整卡片，发音可播，样式不被宿主页污染 | ✅ v0.1.0 |
| **M3 LLM 接入** | background + DeepSeek 适配器 + Settings 页 + 缓存 | 填入真实 key 后划词出真实翻译；key 错误有明确提示 | ✅ v0.1.0 |
| **M4 收藏** | ⭐ 切换 + popup 双入口 + 单词表 + 卡片详情 | 收藏持久化，重开浏览器仍在；可取消收藏 | ✅ v0.1.0 |
| **M5 打磨** | 错误态、防抖、长文本处理、卡片动画 | 边界场景稳定（双击快速划词、超长选区、无网络） | ⬜ 待做 |

---

## 9. 已确认决策（2026-10-22）

| 问题 | 决策 |
|---|---|
| 收藏入口 | 点击插件图标弹 popup，双入口：单词表 / Settings |
| 单词表排序 | 按收藏时间倒序，一行一词，点击进入单词卡页面 |
| Settings 回显 | 打开自动读取并显示已保存值，保存后持久化 |
| 技术栈 | 无构建原生 JS（已落地） |
| 发音 | 浏览器内置 speechSynthesis（en-US） |
| 翻译范围 | MVP 单词卡；短语也能出卡（音标允许为空） |

**遗留（M5 候选）**：长句/段落翻译模式、收藏导出 CSV、输入框内划词、iframe 支持、更多 LLM Provider。

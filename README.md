# WordCard 画词翻译

> A Chrome extension for select-to-translate, powered by LLM (DeepSeek).
> 划词翻译 Chrome 插件 —— 选中文字，点一下，单词卡 / 整句翻译立刻弹出。

[![Chrome](https://img.shields.io/badge/Chrome-Manifest%20V3-534AB7)](https://developer.chrome.com/docs/extensions/develop/migrate) [![Build](https://img.shields.io/badge/build-none%20required-success)]() [![License: MIT](https://img.shields.io/badge/License-MIT-0F6E56.svg)](LICENSE)

选中网页上的任何内容，旁边会浮出一个小图标，点击即可查看：

- **单词卡**（≤ 30 字符）：单词、美/英音标、🔊 发音、中文释义、双语例句，⭐ 一键收藏
- **翻译卡**（> 30 字符）：上方原文、下方译文，长内容自动滚动

翻译由大模型驱动，默认适配 **DeepSeek API**（OpenAI 兼容格式），自带配置页，填入自己的 Key 即可用。

![划词单词](docs/screenshot-word.png)

![整句翻译](docs/screenshot-sentence.png)

## ✨ 功能特性

- 🖱 **划词即译**：鼠标选中文字 → 浮出小图标 → 点击弹出卡片，Esc 或点空白关闭
- 📇 **智能双模式**：短内容走词典模式（音标/释义/例句），长内容自动切换整句翻译模式
- ⭐ **本地收藏**：单词卡一键收藏/取消，点击插件图标查看单词表（按收藏时间倒序，可点开重看卡片）
- 🌐 **中英互译**：自动识别输入语言，英文 → 中文，中文 → 英文
- 🔊 **免费发音**：浏览器内置 TTS，无需第三方服务
- ⚡ **24 小时缓存**：同一内容不重复请求，省 token
- 🔧 **多模型可扩展**：Provider 抽象层设计，适配新的 LLM 只需新增一个文件
- 🧾 **调试日志**：content script 与 background 全链路打印划词内容与 LLM 请求/响应

## 📦 安装（开发者模式加载）

1. 下载或克隆本项目：
   ```bash
   git clone <repo-url>
   ```
2. 打开 Chrome，进入 `chrome://extensions`
3. 右上角开启 **Developer mode**
4. 点击 **Load unpacked**，选择项目根目录（包含 `manifest.json` 的文件夹）

> 修改代码后生效：`chrome://extensions` 中点扩展卡片上的 **↻** 重新加载，再刷新网页。

## 🔑 配置 DeepSeek API Key

1. 注册并登录 [DeepSeek Open Platform](https://platform.deepseek.com)，创建一个 API Key
2. 点击浏览器工具栏的 WordCard 图标 → **Settings**
3. 填写表单：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| Base URL | `https://api.deepseek.com` | 无需修改 |
| Model | `deepseek-chat` | 也可填 `deepseek-reasoner` |
| API Key | — | 你的 `sk-...` 密钥 |

4. 点击 **保存**，再点 **测试连接** 验证（调用 `/models`，不消耗 token）

## 🖱 使用

| 操作 | 效果 |
|---|---|
| 选中文字（拖选 / 双击） | 旁边浮出紫色 "译" 图标 |
| 点击图标 | 弹出单词卡或翻译卡 |
| 点 🔊 | 播放发音（浏览器 TTS） |
| 点 ⭐ | 收藏 / 取消收藏 |
| 点击插件图标 | 单词表 / Settings 双入口 |
| Esc 或点空白处 | 关闭卡片 |

## 🔒 隐私说明

- **API Key 和收藏的单词只存在你自己的浏览器里**（`chrome.storage.local`），不上传到任何服务器，也不会进入代码仓库
- 插件无埋点、不收集任何使用数据
- 翻译请求由你的浏览器直连你所配置的 DeepSeek API，中间无第三方
- 代码完全开源，可自行审计

## 🧱 项目结构

```
selection-translate/
├── manifest.json            # MV3 清单
├── background/
│   └── service-worker.js    # 消息路由 + LLM 调用 + 缓存
├── content/
│   └── content-script.js    # 划词检测、图标、Shadow DOM 卡片
├── providers/
│   └── deepseek.js          # DeepSeek 适配器（JSON mode 结构化输出）
├── storage/
│   └── store.js             # 设置 / 收藏 / 缓存读写
├── popup/
│   ├── popup.html/.js/.css  # 单词表 + 单词卡详情 + Settings
└── icons/                   # 插件图标
```

**设计要点**：

- Manifest V3 + 原生 JS，零构建零依赖，clone 即用
- 卡片 UI 用 Shadow DOM 隔离，不污染宿主页面样式，也不被宿主页覆盖
- 跨域请求统一走 background Service Worker（MV3 下 content script 受 CORS 限制）
- LLM 调用抽象为 Provider 接口（`translate(text, settings)`），适配其他模型只需在 `providers/` 新增文件

## 🛠 调试

| 日志 | 位置 |
|---|---|
| `[WordCard] 鼠标划中的内容` / `icon shown` | 网页 DevTools Console（F12） |
| `[WordCard][bg] 收到消息 / 查询内容 / 缓存命中` | `chrome://extensions` → WordCard → 点击 **service worker** 打开的 Console |
| `[WordCard][LLM] >>> 请求体 / <<< 模型输出 / token 用量` | 同上 |

API Key 在日志中仅显示前 6 位，不会泄露。

## 🗺 Roadmap

- [ ] 更多 LLM Provider（OpenAI / Gemini / Claude / Ollama 本地模型）
- [ ] 收藏列表导出 CSV / 复习模式
- [ ] 输入框内划词支持
- [ ] 卡片内"重新翻译"按钮
- [ ] 上架 Chrome Web Store

## 📄 License

[MIT](LICENSE)

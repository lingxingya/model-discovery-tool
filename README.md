# Model Discovery Tool · 模型发现

> 一个基于 Web 的 LLM 模型发现与管理工具，帮助你在各大 API Provider 中快速探索、配置和测试 AI 模型。

## 📖 简介

Model Discovery Tool（模型发现工具）是为 [OpenClaw](https://github.com/openclaw/openclaw) 用户打造的一款辅助工具。它通过调用 API Provider 的 `/v1/models` 接口，自动发现可用的模型列表，并提供以下核心能力：

- **模型发现** — 输入任意 OpenAI 兼容 API 的 Base URL + API Key，一键拉取可用模型
- **一键配置** — 在 OpenClaw 中添加或删除模型 provider，无需手动编辑配置文件
- **在线测试** — 选中模型后直接在浏览器中对话测试，验证模型可用性和效果
- **额度监控** — 实时显示账户配额（支持 ModelScope 等提供商的 Rate Limit 头信息）

## ✨ 功能特性

### 🎯 模型发现与配置
- 支持任意 OpenAI 兼容 API（OpenAI、ModelScope、SiliconFlow、DeepSeek、ZhipuAI 等）
- 自动探测 `workingBaseUrl`（兼容 `/v1/models` 和 `/models` 两种路径）
- 双区模型列表：**待配置** 与 **已配置**，一目了然
- 点击 `+` / `×` 即可一键添加或删除模型，实时保存到 OpenClaw 配置

### 🏪 预设供应商
内置 23+ 个主流 LLM Provider 预设，分类为：
- **🇨🇳 国内直连** — ModelScope（魔搭）、SiliconFlow（硅基流动）、DeepSeek（深度求索）、ZhipuAI（智谱）、Moonshot（月之暗面）、MiniMax、SenseNova（商汤日日新）等
- **🌍 海外需代理** — OpenAI、Google AI Studio、Anthropic（Claude）、Groq、OpenRouter、Hugging Face 等
- **💻 本地运行** — Ollama、LM Studio

### 📊 额度监控
- 实时显示账户今日总剩余请求额度（🎫）
- 单个模型的独立额度统计（📊）
- 可视化进度条，颜色随剩余比例变化（绿 > 黄 > 红）

> ⚠️ **注意**：额度监控目前仅支持 **ModelScope（魔搭）** API。不同 Provider 返回的 Rate Limit 响应头格式各不相同，暂未做通用适配。
> 其他 Provider（如 OpenAI、DeepSeek 等）使用时不会显示额度信息，不影响正常功能。

### 💬 在线测试
- 直接在浏览器中对模型发送消息，流式（Streaming）响应展示
- 显示响应时间、Token 消耗、生成速度（tok/s）
- 选中模型后自动填充参数，支持覆盖 Context Window 和 Max Tokens

### 🔍 其他
- 搜索过滤 — 按模型 ID 或厂商名称快速查找
- 导入已有配置 — 一键回填已有 Provider 的 Base URL 和 API Key
- 模型规格自动匹配 — 覆盖 60%+ 已知模型的 context_window / max_tokens

## 🚀 快速开始

### 前提条件
- [Node.js](https://nodejs.org/) ≥ 18.0
- [pm2](https://pm2.keymetrics.io/)（推荐生产运行）

### 安装与运行

```bash
# 1. 进入项目目录
cd model-discovery-tool

# 2. 安装依赖
npm install

# 3. 启动（开发模式）
node server.js

# 4. 启动（生产模式，使用 pm2）
pm2 start server.js --name model-discovery
pm2 save
pm2 startup
```

服务启动后，访问 **http://localhost:18800**

### 使用流程

1. **输入 API 信息** — 在左侧面板输入 Provider 的 Base URL 和 API Key
2. **发现模型** — 点击「发现可用模型」按钮，拉取模型列表
3. **配置模型** — 在「待配置」列表中点击 `+` 号，将模型添加到 OpenClaw
4. **测试模型** — 点击模型名称查看详情，在聊天区发送消息测试
5. **管理模型** — 在「已配置」列表中可随时删除不再需要的模型

### 手动输入（通用方式）

> **不选任何预设供应商，直接输入也能用。**

在左侧面板中，直接在 **Base URL** 和 **API Key** 输入框中填写任意 OpenAI 兼容 API 的信息，点击「发现可用模型」即可。

```
Base URL: https://你的-api-地址/v1
API Key:  sk-...
```

无论你是使用内置供应商、导入已有配置，还是直接手动输入，所有方式最终都会填入同一个表单，然后执行同样的模型发现流程。

### 使用预设供应商

点击「🏪 选择供应商」按钮，从 23+ 个预设中选取：
- 选择后会**自动回填** Base URL
- 本地模型（Ollama、LM Studio）会自动填充 `no-key-needed` 并开始发现
- 在线模型需要手动输入 API Key
- 你也可以先选中一个预设，**再修改** Base URL 来适配代理地址或其他端点

## 🏗 技术栈

| 层级 | 技术 |
|------|------|
| **后端** | Node.js (原生 http 模块, 无框架依赖) |
| **前端** | 纯 HTML + CSS + JavaScript (无框架) |
| **运行** | pm2 进程守护 |
| **端口** | 18800 (仅 127.0.0.1) |

## 📁 项目结构

```
model-discovery-tool/
├── server.js            # Node.js 后端服务
├── index.html           # 前端页面 (内联 CSS + JS)
├── model-metadata.json  # 已知模型规格映射表
├── package.json         # 项目依赖
└── README.md            # 本文档
```

## 🔧 配置

### 服务端口
编辑 `server.js`，修改 `PORT` 常量（默认 18800）。

### 仅本地访问
默认绑定 `127.0.0.1`，如需外网访问，修改 `HOST` 为 `0.0.0.0`（注意安全风险）。

### 模型规格映射
`model-metadata.json` 收录了 60+ 已知模型的 context_window 和 max_tokens。如果未收录的模型通过 API 返回了规格信息，会优先使用 API 数据。

## 🤝 贡献

欢迎提交 Issue 和 PR！如果你发现新的 Provider 或已知模型规格缺失，欢迎更新 `model-metadata.json`。

## 📄 许可

MIT License

## 🔗 关联项目

- [OpenClaw](https://github.com/openclaw/openclaw) — AI 消息网关
- [ModelScope](https://modelscope.cn) — 魔搭社区，提供免费的 LLM API

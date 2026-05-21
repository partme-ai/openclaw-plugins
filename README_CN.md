# openclaw-plugins

<p align="center">
  <strong>27+ 企业级插件。一个统一生态。</strong><br>
  <sub>IM 渠道 · 消息队列 · AI 能力 · 基础设施 — 生产级品质，独立发布。</sub>
</p>

<p align="center">
  <a href="https://www.npmjs.com/search?q=%40partme.ai"><img src="https://img.shields.io/badge/npm-@partme.ai-cb3837?logo=npm" alt="npm"></a>
  <a href="https://github.com/partme-ai/openclaw-plugins"><img src="https://img.shields.io/badge/github-partme--ai%2Fopenclaw--plugins-green.svg" alt="GitHub"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg" alt="Node"></a>
  <a href="https://pnpm.io"><img src="https://img.shields.io/badge/pnpm-9-orange.svg" alt="pnpm"></a>
</p>

<p align="center">
  <a href="#-插件目录">插件目录</a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-架构设计">架构设计</a> ·
  <a href="#-文档">文档</a> ·
  <a href="#-生态">生态</a> ·
  <a href="#-技术栈">技术栈</a>
</p>

[English](./README.md) | 简体中文

---

## 什么是 openclaw-plugins？

**openclaw-plugins** 是 [OpenClaw](https://github.com/partme-ai/openclaw) 的官方插件生态 — 一个包含 27+ 个独立发布的 npm 包的 monorepo，统一使用 `@partme.ai` scope。每个插件为 OpenClaw 扩展一项能力：接入一个 IM 渠道、桥接一个消息队列、增加 RAG 知识检索、启用分布式追踪、或集成第三方平台。

**PartMe.AI 团队打造**，面向企业级 AI Agent 基础设施 — 从企业微信客服到多渠道消息路由，从知识库 RAG 到生产级监控。

### 为什么选择 openclaw-plugins？

| 你的需求 | openclaw-plugins 提供的方案 |
|---------|---------------------------|
| 企业微信 / 钉钉 / 飞书 AI 机器人 | **一条命令安装** — `openclaw plugins install` |
| 跨 21 个 IM 渠道路由消息 | **统一 Bridge** — 一个插件，全渠道贯通 |
| 为 Agent 接入 RAG 知识库 | **Knowledge 插件** — embedding + 混合检索 |
| 多层持久记忆 | **Memory 插件** — L0→L3 自动召回 |
| IoT 设备对接 | **MQTT / STOMP / RabbitMQ / Redis / RocketMQ** |
| 生产可观测性 | **Prometheus + OpenTelemetry 追踪 + Nacos** |
| AI 驱动的平台集成 | **高德地图 · 抖音 · 美团 · Gotify** 工具插件 |

**每个插件完全自包含** — 零跨插件依赖，独立版本管理和发布。

---

## 架构设计

openclaw-plugins 遵循与 OpenClaw Gateway 对应的**五层模型**：

```
Layer 5 — 业务应用         SCRM、仪表盘、数据分析
Layer 4 — 路由 + 桥接      规则引擎、转发、审计、跨渠道上下文注入
Layer 3 — AI 能力          知识库/RAG、记忆 L0-L3、追踪、OAuth2
Layer 2 — 基础设施         Nacos、Prometheus、mTLS、Cluster
Layer 1 — 渠道层           IM: 企微/微信/抖音 + Bridge（21 个上游渠道）
                           MQ: MQTT/RabbitMQ/Redis/RocketMQ/STOMP/Web-*
```

**设计原则**：
- **独立**：每个插件是独立的 npm 包 — 禁止跨插件导入
- **一致**：统一的配置结构、错误类型、日志和生命周期
- **可测**：同目录 Vitest 测试，80%+ 覆盖率目标
- **按需**：只安装你需要的 — 无单体依赖树

---

## 插件目录

### IM 渠道

| 包名 | 说明 | 许可证 |
|------|------|--------|
| [@partme.ai/wecom](./extensions/wecom) | 企业微信 Bot + Agent 双模接入，多账号矩阵，10 Skills | ISC |
| [@partme.ai/weixin](./extensions/wechat) | 微信公众号 / 客服消息 | SEE LICENSE |
| [@partme.ai/wecom-kf](./extensions/wecom-kf) | 企业微信客服（外部微信用户） | MIT |
| [@partme.ai/wechat-ipad](./extensions/wechat-ipad) | 微信 iPad 协议 | MIT |
| [@partme.ai/openclaw-bridge](./extensions/bridge) | 统一 IM Bridge — 21 个渠道，一个插件 | MIT |

### AI 能力

| 包名 | 说明 |
|------|------|
| [@partme.ai/openclaw-knowledge](./extensions/knowledge) | RAG 知识库引擎（embedding + vector + hybrid retrieval） |
| [@partme.ai/openclaw-memory](./extensions/memory) | 多级长期记忆系统（L0→L3），自动召回 |
| [@partme.ai/openclaw-router](./extensions/router) | 企业级跨渠道消息路由引擎 |
| [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) | 统一消息格式 SDK，全渠道互通的消息标准 |

### 消息队列 & IoT

| 包名 | 说明 |
|------|------|
| [@partme.ai/openclaw-mqtt](./extensions/mqtt) | MQTT 3.1.1/5.0 协议桥接 |
| [@partme.ai/openclaw-web-mqtt](./extensions/web-mqtt) | Web MQTT（浏览器端） |
| [@partme.ai/openclaw-stomp](./extensions/stomp) | STOMP 协议桥接 |
| [@partme.ai/openclaw-web-stomp](./extensions/web-stomp) | Web STOMP（浏览器端） |
| [@partme.ai/openclaw-rabbitmq](./extensions/rabbitmq) | RabbitMQ 消息队列 |
| [@partme.ai/openclaw-redis-stream](./extensions/redis-stream) | Redis Stream 消息队列 |
| [@partme.ai/openclaw-rocketmq](./extensions/rocketmq) | RocketMQ 消息队列 |
| [@partme.ai/openclaw-cluster](./extensions/cluster) | 集群通信 |

### 基础设施

| 包名 | 说明 |
|------|------|
| [@partme.ai/openclaw-nacos](./extensions/nacos) | Nacos 配置中心 & 服务注册 |
| [@partme.ai/openclaw-prometheus](./extensions/prometheus) | Prometheus 指标监控 |
| [@partme.ai/openclaw-tracing](./extensions/tracing) | OpenTelemetry 分布式追踪 |
| [@partme.ai/openclaw-mtls](./extensions/mtls) | Mutual TLS 认证 |
| [@partme.ai/openclaw-oauth2](./extensions/oauth2) | OAuth 2.0 / Sa-Token 集成 |

### 平台集成

| 包名 | 说明 |
|------|------|
| [@partme.ai/openclaw-gotify](./extensions/gotify) | Gotify 推送通知 |
| [@partme.ai/openclaw-amap](./extensions/amap) | 高德地图 |
| [@partme.ai/openclaw-douyin](./extensions/douyin) | 抖音 |
| [@partme.ai/openclaw-meituan](./extensions/meituan) | 美团 |
| [@partme.ai/openclaw-rednode](./extensions/rednode) | RedNode 集成 |

---

## 快速开始

### 环境要求

- **Node.js** >= 22.0.0
- **pnpm** >= 9
- **OpenClaw** >= 2026.4.12

### 安装插件

```bash
# 从 npm 直接安装
openclaw plugins install @partme.ai/wecom

# 或交互式配置
openclaw channels add
```

### 开发

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install

# 构建所有插件
pnpm build

# TypeScript 检查所有插件
pnpm typecheck

# 运行所有测试
pnpm test

# 开发单个插件
cd extensions/wecom
pnpm dev            # watch 模式
pnpm test:watch     # 测试 watch 模式
```

### 创建新插件

```bash
pnpm new-plugin <name> --label "显示名称" --desc "描述"
```

所有插件遵循 [Plugin Specification](./spec/PLUGIN_SPEC.md) 规范。

---

## 文档

| 文档 | 说明 |
|------|------|
| [快速入门](./doc/OpenClaw-Plugins-Getting-Started.md) | 安装和配置插件 |
| [架构设计](./doc/OpenClaw-Plugins-Architecture_CN.md) (CN) / [Architecture](./doc/OpenClaw-Plugins-Architecture.md) (EN) | 项目架构与设计决策 |
| [贡献指南](./doc/OpenClaw-Plugins-Contributing.md) | 如何添加新插件 |
| [插件规范](./spec/PLUGIN_SPEC.md) | 插件契约：入口、配置、通道、生命周期 |
| [企业微信指南](./doc/im-channels/wecom/OpenClaw-WeCom-Configuration.md) | 企业微信全配置指南 |
| [消息 SDK](./extensions/message-sdk/README.md) | 统一消息格式 SDK API 参考 |

### 按角色阅读

| 角色 | 建议先读 |
|------|---------|
| **新用户** | [快速入门](./doc/OpenClaw-Plugins-Getting-Started.md) → 选一个渠道插件安装 |
| **插件开发者** | [插件规范](./spec/PLUGIN_SPEC.md) → [贡献指南](./doc/OpenClaw-Plugins-Contributing.md) → 参考现有插件 |
| **架构师** | [架构设计](./doc/OpenClaw-Plugins-Architecture_CN.md) → [消息 SDK](./extensions/message-sdk/README.md) |

---

## 生态

### 官方上游渠道

以下 IM 渠道由平台官方团队维护，通过 `@partme.ai/openclaw-bridge` 统一接入 PartMe.AI 生态：

| 渠道 | 官方插件 | 代码仓库 |
|------|---------|---------|
| 钉钉 | `@dingtalk-real-ai/dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) |
| 飞书/Lark | `@larksuite/openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) |
| QQ | `@tencent-connect/openclaw-qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) |

另有 18 个内置渠道（Discord、Slack、Telegram、WhatsApp、Signal、LINE、Matrix、iMessage、SMS、Microsoft Teams、Google Chat、WebChat、BlueBubbles、Zalo、Mattermost、Nextcloud Talk、Mastodon、Nostr）— 全部通过 `@partme.ai/openclaw-bridge` 统一桥接。

---

## 技术栈

| 组件 | 技术 |
|------|------|
| **运行时** | Node.js 22+（ESM） |
| **语言** | TypeScript 5.x（strict mode） |
| **包管理** | pnpm 9（workspaces） |
| **构建** | tsup（ES2022）/ tsc |
| **测试** | Vitest 4.x |
| **配置校验** | Zod 4.x |
| **HTTP 客户端** | undici |
| **消息格式** | [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) |
| **CI/CD** | GitHub Actions（按插件矩阵构建） |

---

## 许可证

各插件按各自许可证发布（见上方表格）。  
核心基础设施和自建插件：**MIT License**。  
Fork 官方插件保留原始许可证。

**Made with ❤️ by PartMe.AI Team**

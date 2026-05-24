<div align="center">

# openclaw-plugins

**28 个企业级插件。一个统一生态。**

*IM 渠道 · 消息队列 · AI 能力 · 基础设施 — 生产级品质，独立发布。*

[![npm](https://img.shields.io/badge/npm-@partme.ai-cb3837?logo=npm)](https://www.npmjs.com/search?q=%40partme.ai)
[![GitHub](https://img.shields.io/badge/github-partme--ai%2Fopenclaw--plugins-green.svg)](https://github.com/partme-ai/openclaw-plugins)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9-orange.svg)](https://pnpm.io)

[English](./README.md) | 简体中文

[简介](#-简介) ·
[设计理念](#-核心设计理念) ·
[架构](#-架构) ·
[插件](#-插件目录) ·
[快速开始](#-快速开始) ·
[核心功能](#-核心功能) ·
[开发](#-插件开发) ·
[CI/CD](#-cicd) ·
[文档](#-文档) ·
[贡献](#-贡献指南)

</div>

---

## 📖 简介

**openclaw-plugins** 是 [OpenClaw](https://github.com/partme-ai/openclaw) 的官方企业级插件生态 — 一个 **pnpm monorepo**，包含 **28 个独立发布的 npm 包**，统一使用 `@partme.ai` scope，由 **PartMe.AI** 团队维护。

OpenClaw Gateway 以 AI Agent 为枢纽。本仓库将 **IM 渠道**、**消息队列**、**RAG 知识库**、**长期记忆**、**可观测性** 与 **企业基础设施** 连接成闭环的多平台信息流。

每个插件**完全自包含**：除共享库 `@partme.ai/openclaw-message-sdk` 外，零跨插件运行时依赖。按需安装，独立版本管理与发布。

### 我们要解决的问题

| 缺口 | 问题 | 解决方案 |
|------|------|----------|
| **跨渠道路由** | IM 消息无法自动转发到 MQ；MQ 消息无法回复到 IM | [@partme.ai/openclaw-router](./extensions/router) |
| **知识库开箱即用** | Agent 需主动调用 RAG 工具 | Router + [@partme.ai/openclaw-knowledge](./extensions/knowledge) 通过 `before_prompt_build` 自动注入 |
| **长期记忆** | 每次对话从零开始 | [@partme.ai/openclaw-memory](./extensions/memory)（L0→L3）+ [@partme.ai/openclaw-openmem](./extensions/openmem) |
| **消息审计** | 缺少统一消息记录 | Router 审计 + MQ forward-copy 规则 |
| **统一线传输格式** | 各 MQ 插件重复实现解析 | [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) Wire / Transcript 双路径 |

完整设计见 [架构设计](./doc/OpenClaw-Plugins-Architecture_CN.md)。

---

## 🎯 核心设计理念

#### **插件自包含**

- 每个插件对应 `extensions/<name>/` 下一个 npm 包
- 运行时不依赖兄弟插件
- **例外**：`@partme.ai/openclaw-message-sdk` — 共享消息类型、入栈/出栈与 OpenClaw 桥接
- **Monorepo 开发**：消费者使用 `workspace:^<sdkVersion>`；`publish-changed.mjs` 在 npm 发布时临时 materialize 为 `^version`，发布后还原

#### **绝不修改渠道代码**

> OpenClaw 的 `api.on("agent_end", ctx)` 对**所有**渠道触发。非渠道插件可观察全部消息流。

**router** 与 **bridge** 位于渠道插件外部，监听 `agent_end` 与 `before_prompt_build`，实现跨渠道路由、审计转发与上下文注入，无需 fork wecom、mqtt 或任何上游渠道。

#### **message-sdk 双路径（Wire vs Transcript）**

| 路径 | 典型插件 | SDK 入口 | 场景 |
|------|----------|----------|------|
| **Wire** | mqtt、rabbitmq、redis-stream、rocketmq、stomp、web-mqtt、web-stomp | `dispatchWireMessage` → `dispatchInbound` | 机读 JSON 信封 |
| **Transcript** | gotify、wecom、类飞书 IM | `dispatchTranscriptTurn` → `turn.runAssembled` | Control UI 人类可读轮次 |

两路径共享 `UnifiedMessage`、去重与回复辅助。详见 [message-sdk 架构](./extensions/message-sdk/docs/ARCHITECTURE.md)。

#### 平台集成渠道 SDK 复用（douyin · meituan · rednode）

公域 Webhook 渠道采用 **Transcript 路径**（与 wecom-kf / gotify 对齐），复用 message-sdk 能力如下：

| SDK 能力 | 插件落点 | 说明 |
|----------|----------|------|
| `readRequestBodyWithLimit` | `src/inbound.ts` | Webhook body 限流读取，超限 413 |
| `createIdempotencyCache` | `src/dispatch/dispatch-inbound.ts` | `msg-id` 内存幂等（60s TTL） |
| `dispatchTranscriptTurn` | `src/dispatch/transcript-dispatch.ts` | `turn.runAssembled` 优先，Control UI transcript |
| `parseMediaDirectives` / `resolveOutboundMedia` | `src/dispatch/outbound-reply.ts` | Agent 回复 MEDIA 指令与出站媒体解析 |
| `buildAgentReplyTimeoutSummary` | `transcript-dispatch.ts` | Agent 超时用户可见文案 |
| `resolveChannelMediaMaxBytes` 等 | `src/config/resolvers.ts` | 媒体上限、Agent 超时、出口代理 |
| `undiciFetch` | `src/shared/http.ts` → OpenAPI 客户端 | 替代裸 `fetch`，支持 egress 代理 |

参考实现：`extensions/wecom-kf/src/dispatch/kf-transcript-dispatch.ts`（KF 专用逻辑勿复制，仅复用编排模式）。

#### **多账户隔离**

多数渠道插件支持 `accounts` + `defaultAccount`。会话、Agent 与运行时状态按 `accountId` 完全隔离 — 一个 Gateway，多租户。

---

## ✨ 生态能力

| 层级 | 分类 | 数量 | 代表包 | 核心能力 |
|------|------|------|--------|----------|
| L1 | **IM（自建）** | 6 | wecom、weixin、wecom-kf、wechat-ipad、douyin、gotify | Bot/Webhook/Agent · 媒体 · 去重 · Skills |
| L1 | **IM（桥接）** | 1 + 21 上游 | openclaw-bridge | 上下文注入 · UnifiedMessage MQ 转发 · 21 个内置渠道 |
| L1 | **消息队列** | 8 | mqtt、web-mqtt、stomp、web-stomp、rabbitmq、redis-stream、rocketmq、cluster | topicBindings · Wire 分发 · 幂等 · 多协议发现 |
| L2 | **AI 能力** | 5 | knowledge、memory、router、openmem、message-sdk | RAG · L0–L3 记忆 · 路由规则 · OpenMem HTTP 桥 · 统一线格式 |
| L2–L4 | **基础设施** | 5 | nacos、prometheus、tracing、oauth2、mtls | 配置中心 · 指标 · OTel · 认证 · mTLS |
| — | **平台集成** | 3 | amap、meituan、rednode | POI/店铺 Webhook · 小红书双模式 |

**完整插件矩阵**（28 个包、npm 名、功能说明）：[架构设计 — 插件总览](./doc/OpenClaw-Plugins-Architecture_CN.md)。

---

## 🏢 适用场景

| 场景 | 典型插件组合 |
|------|--------------|
| **企业 IM 智能客服** | wecom / wecom-kf + knowledge + memory + router |
| **业务系统 ↔ Agent** | mqtt / rabbitmq + message-sdk Wire 路径 |
| **多云配置与注册** | nacos + cluster |
| **生产可观测** | prometheus + tracing |
| **全渠道接入且不 fork 上游** | openclaw-bridge + 官方钉钉 / 飞书 / QQ 连接器 |
| **本地优先外部记忆** | openmem + OpenMem 侧车（端口 3317） |
| **移动端推送告警** | gotify + prometheus / 自定义发布者 |

---

## 📦 项目定位

**openclaw-plugins** 面向**生产级企业 AI Agent 基础设施**，而非 Demo：

- **独立 npm 发布** — 每个 `@partme.ai/*` 包单独版本（活跃插件使用 `YYYY.M.D`）
- **可组合** — Gateway + 按需插件
- **上游友好** — 官方钉钉 / 飞书 / QQ 插件**不 fork**，经 bridge 接入
- **OpenClaw 原生** — 实现 Plugin API、ChannelPlugin、Memory Host SDK、setupEntry 等契约

---

## 🏗️ 架构

### 五层模型

```
┌─────────────────────────────────────────────────────────────┐
│  第五层 — 业务应用                                          │
│  SCRM 仪表盘 · 在线客服控制台 · 数据分析                      │
│  订阅 MQ 话题获取实时会话流                                  │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  第四层 — 路由 + 桥接                                       │
│  规则引擎 · 转发引擎 · 审计 · 知识/记忆注入                    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  第三层 — OpenClaw Agent                                    │
│  Agent-1（运维）· Agent-2（销售）· Agent-3（客服）…           │
│  bindings[].match → agentId · memory + knowledge + tools    │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  第二层 — AI 能力                                           │
│  knowledge（RAG）· memory（L0→L3）· openmem · tracing        │
└────────────────────────────┬────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────┐
│  第一层 — 渠道层（无需修改渠道代码）                           │
│  IM：wecom wechat wecom-kf gotify … + bridge（21 上游）      │
│  MQ：mqtt rabbitmq redis-stream rocketmq stomp cluster …    │
└─────────────────────────────────────────────────────────────┘
```

### Monorepo 结构

```
openclaw-plugins/
├── extensions/              # 28 个 npm 包（不含 _template）
│   ├── wecom/ mqtt/ …         # 渠道与能力插件
│   └── message-sdk/           # 共享库（非 Gateway 插件）
├── doc/                       # 架构、入门、贡献
├── spec/PLUGIN_SPEC.md        # 插件契约
├── scripts/
│   ├── publish-changed.mjs    # npm 发布 + workspace materialize
│   └── sync-message-sdk-deps.mjs
└── .github/workflows/         # CI、nacos 构建、发布
```

### message-sdk 分层

| 层级 | 职责 | 位置 |
|------|------|------|
| **传输层** | 连接、订阅、发布、ACK、平台协议 | 各 MQ/IM 扩展 |
| **消息层** | UnifiedMessage、解析/序列化、去重、bridge 分发 | message-sdk |
| **智能体层** | 路由、会话、LLM | OpenClaw Gateway |

### 三种消息流

**流 1 — IM 入站（用户 → Agent → MQ 审计）**

```
用户 @企业微信 → [wecom] → Agent → 回复企业微信
                              └── [router] agent_end → forward-copy → [mqtt] 审计话题 → SCRM
```

**流 2 — MQ 入站（业务系统 → Agent → IM 回复）**

```
监控系统 → MQTT 发布 → [mqtt] → Agent → 同话题回复
                              └── [router] agent_end → reply-via:wecom → 运维收到告警
```

**流 3 — 增强（每次对话）**

```
任意消息 → [router] before_prompt_build
             ├─ [knowledge] 自动检索 → 注入 system 上下文
             └─ [memory] 自动召回 → 注入用户历史
           → Agent 无需显式 tool call 即获得 RAG + 记忆
```

完整流程图：[架构设计 §2.3](./doc/OpenClaw-Plugins-Architecture_CN.md)。

---

## 📋 插件目录

按分类摘要。npm 名称、渠道 ID、端口与功能矩阵见 [架构设计文档](./doc/OpenClaw-Plugins-Architecture_CN.md)。

| 分类 | 包数量 | 亮点 |
|------|--------|------|
| **IM（自建）** | 6 | 企业微信双模式 · 微信公众号 · 企业微信客服 · 微信 iPad · 抖音 · Gotify 推送 |
| **IM（桥接）** | 1 | 21 个上游渠道统一配置 — 见 [bridge README](./extensions/bridge/README.zh-CN.md) |
| **AI 与路由** | 5 | knowledge · memory · router · openmem · message-sdk |
| **消息队列** | 8 | MQTT/STOMP/RabbitMQ/Redis/RocketMQ + Web 变体 + 集群发现 |
| **基础设施** | 5 | nacos · prometheus · tracing · oauth2 · mtls |
| **平台集成** | 3 | amap · meituan · rednode（小红书）|

**MQ 插件共性**：`topicBindings` · `payload.mode`（jsonTextOrPlain / jsonOnly / plainText）· `dispatch.mode`（reply-pipeline / embedded-agent / subagent）· `idempotency`（TTL 去重）。

各插件详细说明见 `extensions/<name>/README.zh-CN.md`。

---

## 🔗 官方上游

以下 IM 渠道由平台官方维护，通过 `@partme.ai/openclaw-bridge` 接入 PartMe.AI 生态 — **无需本地 fork**：

| 平台 | 官方插件 | 仓库 | 文档 |
|------|---------|------|------|
| 钉钉 | `@dingtalk-real-ai/dingtalk-connector` | [dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) |
| 飞书 / Lark | `@larksuite/openclaw-lark` | [openclaw-lark](https://github.com/larksuite/openclaw-lark) | [官方文档](https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh) |
| QQ | `@tencent-connect/openclaw-qqbot` | [openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | — |

### Bundled 渠道（18 个）

随 OpenClaw 内置，通过 `@partme.ai/openclaw-bridge` 配置即可接入，无需额外安装：

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

---

## 📖 快速开始

#### 前置要求

- **Node.js** >= 22.0.0
- **pnpm** >= 9（Monorepo 贡献者）
- **OpenClaw** >= 2026.4.12 — [OpenClaw 仓库](https://github.com/partme-ai/openclaw)

#### 1. 安装 OpenClaw Gateway

按 OpenClaw 项目文档在主机或集群上安装并启动 Gateway。

#### 2. 安装插件

```bash
# 自建 IM 渠道
openclaw plugins install @partme.ai/wecom
openclaw plugins install @partme.ai/openclaw-gotify

# 官方上游（单独安装后由 bridge 统一接入）
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
openclaw plugins install @larksuite/openclaw-lark
openclaw plugins install @tencent-connect/openclaw-qqbot

# 桥接适配器
openclaw plugins install @partme.ai/openclaw-bridge

# AI 能力与基础设施
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw plugins install @partme.ai/openclaw-memory
openclaw plugins install @partme.ai/openclaw-router
openclaw plugins install @partme.ai/openclaw-nacos
openclaw plugins install @partme.ai/openclaw-prometheus

# 消息队列
openclaw plugins install @partme.ai/openclaw-mqtt
openclaw plugins install @partme.ai/openclaw-rabbitmq
```

#### 3. 配置（最小示例）

```json
{
  "channels": {
    "wecom": {
      "enabled": true,
      "dmPolicy": "open",
      "groupPolicy": "open",
      "defaultAccount": "main",
      "accounts": {
        "main": {
          "botId": "your-bot-id",
          "secret": "your-secret"
        }
      }
    }
  }
}
```

常用字段：`enabled`、`dmPolicy`、`groupPolicy`、`allowFrom`、`accounts`、`defaultAccount`。详见 [快速开始](./doc/OpenClaw-Plugins-Getting-Started_CN.md)。

#### 4. 重启 Gateway

```bash
openclaw gateway restart
```

#### 5. 源码开发

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install
pnpm build
pnpm typecheck

cd extensions/wecom
pnpm dev            # 监视模式
pnpm test           # vitest
```

#### 6. Monorepo：同步 message-sdk 依赖

升级 `extensions/message-sdk` 版本后：

```bash
pnpm sync-message-sdk-deps
pnpm install
```

---

## 📝 核心功能

#### 1. 跨渠道路由（router）

- 监听**所有**渠道的 `agent_end`
- 规则引擎：forward-copy、reply-via、话题模板
- 审计日志写入 MQ，无需修改渠道代码
- 核心路由逻辑约 118 行 — 见 [router](./extensions/router)

#### 2. RAG 知识库（knowledge）

- 5 种 embedding 提供商（OpenAI、DashScope、智谱、千帆、Ollama）
- 3 种向量存储（sqlite-vec、zvec、zvec-native）
- 混合检索、重排序、意图门控
- 与 router 配合时通过 `before_prompt_build` 自动注入

#### 3. 长期记忆（memory + openmem）

- **memory**：L0→L3 层级、`kind: "memory"` 契约、JSONL 存储、关键词搜索、自动召回
- **openmem**：OpenMem 侧车 HTTP 桥 — `/inspect/search` 混合召回、`/events/ingest` 写入、`openmem_search` 工具

#### 4. 统一 MQ 接入（message-sdk + MQ 插件）

- Wire JSON 信封 v1，兼容纯文本
- 共享 `topicBindings`、分发模式、幂等缓存
- 插件：mqtt、rabbitmq、redis-stream、rocketmq、stomp、web-mqtt、web-stomp、cluster

#### 5. 企业基础设施

- **nacos**：Spring Cloud 兼容配置合并、服务注册、集群发现（[Nacos 文档](./doc/nacos/zh/OpenClaw-Nacos-Guide_CN.md)）
- **oauth2**：Sa-Token、Keycloak、Auth0、Azure AD、通用 JWT/introspection
- **mtls**：客户端证书白名单、保护路径、透传模式

#### 6. 可观测性

- **prometheus**：端口 9090、scrape 认证、模型用量直方图、Grafana 仪表盘
- **tracing**：OpenTelemetry — log / file / OTLP / SkyWalking 后端、采样、跨度限制

---

## 🛠️ 插件开发

所有插件遵循 [插件规范](./spec/PLUGIN_SPEC.md)。脚手架：

```bash
pnpm new-plugin <name> --label "显示名称" --desc "描述"
```

| 文件 | 用途 |
|------|------|
| `index.ts` | 入口：`id`、`name`、`configSchema`、`register(api)` |
| `openclaw.plugin.json` | 清单：渠道、配置 schema、契约 |
| `package.json` | npm 元数据、`openclaw` 块、`@partme.ai/<name>` |
| `src/channel.ts` | ChannelPlugin 实现（渠道插件） |
| `src/config.ts` | Zod schema + JSON Schema 导出 |
| `src/runtime.ts` | 运行时单例 |
| `src/monitor.ts` | 去重（60s TTL，10K 上限）+ webhook 处理 |
| `src/media.ts` | `detectMediaType`、`loadMedia`、`downloadMedia` |

### 入口模式

```typescript
// 模式 A：直接对象导出（大多数插件）
const plugin = { id, name, configSchema, register(api) { ... } };
export default plugin;

// 模式 B：defineChannelPluginEntry（wechat、部分 MQ 插件）
export default defineChannelPluginEntry({ id, plugin, setRuntime });

// 模式 C：src/ 重导出（基础设施与平台插件）
export { default } from "./src/index.js";
```

### Manifest 模式

| 模式 | 插件类型 | 示例 |
|------|----------|------|
| 完整 channel + channelConfigs schema | 渠道插件 | wecom、mqtt、gotify、rabbitmq |
| 简单 channel 配置 | 轻量渠道 | amap、meituan、wechat-ipad |
| 纯能力（无 channels） | 基础设施 / AI | knowledge、prometheus、nacos、tracing |
| 最小化（`additionalProperties: true`） | Router、bridge | router、bridge |

要求：TypeScript strict、Zod 校验、同目录测试、80%+ 覆盖率目标。完整指南：[贡献指南](./doc/OpenClaw-Plugins-Contributing_CN.md)。

---

## 🔄 CI/CD

| 工作流 | 文件 | 说明 |
|--------|------|------|
| CI | `.github/workflows/ci.yml` | 按变更插件矩阵：install → typecheck → build |
| Nacos | `.github/workflows/build-nacos.yml` | nacos 独立严格构建 + 测试 |
| 发布 | `.github/workflows/publish.yml` | 手动触发，默认 dry-run |

### 发布

```bash
node scripts/publish-changed.mjs --dry-run
node scripts/publish-changed.mjs --plugin wecom
node scripts/publish-changed.mjs
node scripts/publish-changed.mjs --plugin wecom --tag next   # 预发布
```

**Workspace 依赖**：开发时消费者声明 `workspace:^<sdkVersion>`；发布脚本临时替换为 npm `^version`，发布后还原 `package.json`。

---

## 🛠️ 技术栈

#### 核心

- **Node.js** 22+（ESM）
- **TypeScript** 5.x strict
- **pnpm** 9 workspaces
- **OpenClaw** Plugin API >= 2026.4.6

#### 构建与测试

- **tsup**（ES2022）/ **tsc** — 生产构建
- **Vitest** 4.x — 同目录 `*.test.ts`
- **Zod** 4.x — 运行时配置校验

#### 集成

- **undici** — HTTP 客户端（适用场景）
- **@partme.ai/openclaw-message-sdk** — 统一线格式 + bridge
- 各插件平台 SDK（nacos、amqp、mqtt 等）

#### 可观测性

- **Prometheus** 指标导出
- **OpenTelemetry** 追踪（OTLP / SkyWalking / file / log）

---

## 📦 版本信息

| 项 | 当前 |
|----|------|
| OpenClaw peer 依赖 | >= 2026.4.12 |
| message-sdk | 2026.5.24 |
| openclaw-nacos | 2026.5.24 |
| openclaw-gotify | 2026.5.22 |
| 多数活跃插件 | 2026.5.20 |
| 版本策略 | `YYYY.M.D`（活跃）· semver（稳定）· 预发布 `--tag next` |

npm 已发布版本：[@partme.ai on npm](https://www.npmjs.com/search?q=%40partme.ai)。

---

## 📚 文档

| 文档 | 说明 |
|------|------|
| [Architecture](./doc/OpenClaw-Plugins-Architecture.md) / [架构设计](./doc/OpenClaw-Plugins-Architecture_CN.md) | 五层架构与插件矩阵 |
| [Getting Started](./doc/OpenClaw-Plugins-Getting-Started.md) / [快速开始](./doc/OpenClaw-Plugins-Getting-Started_CN.md) | 安装、配置、多账户 |
| [Contributing](./doc/OpenClaw-Plugins-Contributing.md) / [贡献指南](./doc/OpenClaw-Plugins-Contributing_CN.md) | 新插件脚手架与测试约定 |
| [Plugin Spec](./spec/PLUGIN_SPEC.md) | 插件契约 |
| [message-sdk 架构](./extensions/message-sdk/docs/ARCHITECTURE.md) | Wire vs Transcript、bridge API |
| [Nacos 指南](./doc/nacos/zh/OpenClaw-Nacos-Guide_CN.md) | 配置中心与服务注册 |
| [WeCom 配置](./doc/wecom/OpenClaw-WeCom-Configuration.md) | 企业微信完整配置 |
| [WeCom 联调测试](./doc/wecom/OpenClaw-WeCom-Testing.md) | 主动发消息、多 Bot、CLI 联调 |
| [Bridge README](./extensions/bridge/README.zh-CN.md) | 21 渠道统一配置 |
| [文档索引](./doc/README.md) | 全部专题指南（prometheus、gotify、rocketmq 等） |

---

## 🔗 相关链接

#### 官方资源

- **OpenClaw**：[github.com/partme-ai/openclaw](https://github.com/partme-ai/openclaw)
- **openclaw-plugins**：[github.com/partme-ai/openclaw-plugins](https://github.com/partme-ai/openclaw-plugins)
- **npm scope**：[npmjs.com — @partme.ai](https://www.npmjs.com/search?q=%40partme.ai)
- **Issues**：[GitHub Issues](https://github.com/partme-ai/openclaw-plugins/issues)

#### 上游连接器

- [钉钉 OpenClaw Connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector)
- [飞书 OpenClaw Lark](https://github.com/larksuite/openclaw-lark)
- [腾讯 QQ Bot](https://github.com/tencent-connect/openclaw-qqbot)

---

## 🤝 贡献指南

欢迎贡献。典型流程：

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/my-plugin`）
3. 提交更改（`git commit -m 'feat(wecom): add example handler'`）
4. 推送到分支（`git push origin feature/my-plugin`）
5. 提交 Pull Request

使用 `pnpm new-plugin` 生成脚手架。请在插件目录内通过 `pnpm test` 与 `pnpm typecheck`。详见 [贡献指南](./doc/OpenClaw-Plugins-Contributing_CN.md)。

---

## 📄 许可证

各插件按各自许可证发布。核心基础设施与自建插件：**MIT License**。上游衍生插件保留原许可证。

---

## 🙏 致谢

感谢以下项目与团队：

- [OpenClaw](https://github.com/partme-ai/openclaw) — AI Agent 网关
- [Nacos](https://nacos.io) — 配置与服务发现
- [Vitest](https://vitest.dev) — 测试框架
- [pnpm](https://pnpm.io) — Monorepo 包管理
- 钉钉 / 飞书 / 腾讯 — 官方渠道连接器

---

<div align="center">

**如果这个项目对你有帮助，请给我们一个 ⭐️**

Made with ❤️ by PartMe.AI Team

</div>

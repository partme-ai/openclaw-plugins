# openclaw-plugins

<p align="center">
  <strong>28 个企业级插件。一个统一生态。</strong><br>
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
  <a href="#-插件列表">插件列表</a> ·
  <a href="#-快速开始">快速开始</a> ·
  <a href="#-架构">架构</a> ·
  <a href="#-官方上游">官方上游</a> ·
  <a href="#-插件开发">插件开发</a> ·
  <a href="#-cicd">CI/CD</a>
</p>

[English](./README.md) | 简体中文

---

## 什么是 openclaw-plugins？

**openclaw-plugins** 是 [OpenClaw](https://github.com/partme-ai/openclaw) 的官方插件生态 — 一个 pnpm monorepo，包含 28 个独立发布的 npm 包，统一使用 `@partme.ai` scope。由 **PartMe.AI** 团队打造，面向企业级 AI Agent 基础设施。

每个插件**完全自包含** — 零跨插件依赖，独立版本管理和发布。按需安装，无需单体依赖树。

---

## 插件列表

### IM 渠道

| 包 | 渠道 ID | 说明 | 来源 |
|---|--------|------|------|
| [@partme.ai/wecom](./extensions/wecom) | `wecom` | 企业微信 Bot + Agent 双模式 · WebSocket / Webhook / Agent 三连接 · 20 Skills · MCP 工具 · 动态 Agent 路由 · 77 源文件 | 自建 |
| [@partme.ai/weixin](./extensions/wechat) | `openclaw-weixin` | 微信公众号 / 客服消息 · iLink 长轮询协议 · CDN 上传 · SILK 音频 | 自建 |
| [@partme.ai/wecom-kf](./extensions/wecom-kf) | `wecom-kf` | 企业微信客服（外部微信用户）· 转人工 · 会话管理 · 满意度评价 · ICS REST API | 自建 |
| [@partme.ai/wechat-ipad](./extensions/wechat-ipad) | `wechat-ipad` | 微信 iPad 协议桥接 · 个人微信集成 | 自建 |
| [@partme.ai/openclaw-douyin](./extensions/douyin) | `douyin` | 抖音 · OAuth · Webhook | 自建 |
| [@partme.ai/openclaw-bridge](./extensions/bridge) | 21 渠道 | 统一 IM 桥接 — 一个插件，21 个渠道（钉钉 / 飞书 / QQ / Discord / Slack / Telegram / WhatsApp / Signal / LINE / Matrix / IRC / Teams / Google Chat / iMessage / Mattermost / Nextcloud Talk / Nostr / Zalo / Twitch / Tlon / Synology Chat）· 上下文注入 + UnifiedMessage MQ 转发 | 桥接适配 |

### AI 能力

| 包 | 插件 ID | 说明 | 核心功能 |
|---|--------|------|---------|
| [@partme.ai/openclaw-knowledge](./extensions/knowledge) | `knowledge` | RAG 知识库引擎 | 5 种 embedding 提供商 · 3 种向量存储 · 混合检索 · 重排序 · 意图门控 · `before_prompt_build` 自动注入 |
| [@partme.ai/openclaw-memory](./extensions/memory) | `memory` | 多级长期记忆 (L0→L3) | `kind: "memory"` 契约 · MemorySearchManager 接口 · JSONL 存储 · 关键词搜索 · 自动召回 |
| [@partme.ai/openclaw-router](./extensions/router) | `router` | 企业级跨渠道消息路由引擎 | 118 行核心逻辑 · `agent_end` 监听 · 规则匹配 · 跨渠道转发/回复 · 模板话题 |
| [@partme.ai/openclaw-message-sdk](./extensions/message-sdk) | *(共享库)* | 统一消息格式 SDK | `UnifiedMessage` 类型 + 构造器 · 媒体解析 · HTTP 客户端 + 重试 · 腾讯云 ASR · OCR · TTS |

### 消息队列 & IoT

| 包 | 渠道 ID | 端口 | 协议 | 核心功能 |
|---|--------|------|------|---------|
| [@partme.ai/openclaw-mqtt](./extensions/mqtt) | `mqtt` | — | MQTT 3.1.1/5.0 | Broker · ACL · QoS · 话题路由 · 遗嘱处理 · Redis 持久化 |
| [@partme.ai/openclaw-web-mqtt](./extensions/web-mqtt) | `mqtt-ws` | 15675 | MQTT over WebSocket | 用户认证 · ACL 规则 · TLS (WSS) · 话题绑定 |
| [@partme.ai/openclaw-stomp](./extensions/stomp) | `stomp-tcp` | 61613 | STOMP 1.0/1.1/1.2 (TCP) | TLS 端口 61614 · 心跳 · 认证 · 订阅管理 |
| [@partme.ai/openclaw-web-stomp](./extensions/web-stomp) | `stomp` | 15674 | STOMP over WebSocket | 帧解析器 · 目标路由 · 确认处理 |
| [@partme.ai/openclaw-rabbitmq](./extensions/rabbitmq) | `rabbitmq` | — | AMQP 0-9-1 | Exchange (topic/direct/fanout/headers) · 仲裁队列 · 重试 DLX · 幂等 |
| [@partme.ai/openclaw-redis-stream](./extensions/redis-stream) | `redis-stream` | — | Redis Pub/Sub + Stream | 消费者组 · 双模式 · 字段映射 · 重连 |
| [@partme.ai/openclaw-rocketmq](./extensions/rocketmq) | `rocketmq` | — | RocketMQ 5.x | Producer/Consumer · 话题/标签绑定 · 会话凭证 · 分发模式 |
| [@partme.ai/openclaw-cluster](./extensions/cluster) | — | — | 多协议 | 8 种发现模式 · 配置同步 · 会话存储 · 代理 |

**MQ 插件共同模式**: `topicBindings` (topicPattern → agentId/accountId/replyTopic) · `payload.mode` · `dispatch.mode` · `idempotency` (TTL 去重)。

### 基础设施

| 包 | 插件 ID | 说明 | 核心功能 |
|---|--------|------|---------|
| [@partme.ai/openclaw-nacos](./extensions/nacos) | `openclaw-nacos` | Nacos 配置中心 & 服务注册 | Spring Cloud 兼容 · 共享配置合并 · 集群发现 · 30+ 配置属性 |
| [@partme.ai/openclaw-prometheus](./extensions/prometheus) | `openclaw-prometheus` | Prometheus 指标监控 | 端口 9090 · scrape 认证 · 模型用量直方图 · 运行时指标 · Grafana |
| [@partme.ai/openclaw-tracing](./extensions/tracing) | `openclaw-tracing` | OpenTelemetry 分布式追踪 | 4 种后端 · 采样率 · 跨度限制 |
| [@partme.ai/openclaw-mtls](./extensions/mtls) | `openclaw-mtls` | Mutual TLS 认证 | 证书管理 · 客户端白名单 · 保护路径 · 透传模式 |
| [@partme.ai/openclaw-oauth2](./extensions/oauth2) | `openclaw-oauth2` | OAuth 2.0 认证 | 5 种提供商 · JWT · introspection |
| [@partme.ai/openclaw-gotify](./extensions/gotify) | `openclaw-gotify` | Gotify 推送通知 | REST + WebSocket · 自动创建应用 · 多账户 · 优先级 |

### 平台集成

| 包 | 渠道 ID | 说明 | 核心功能 |
|---|--------|------|---------|
| [@partme.ai/openclaw-amap](./extensions/amap) | `amap` | 高德地图 | POI 管理 · Webhook |
| [@partme.ai/openclaw-meituan](./extensions/meituan) | `meituan` | 美团 | 店铺管理 · Webhook |
| [@partme.ai/openclaw-rednode](./extensions/rednode) | `xhs` | 小红书 | 双模式（直连 + ddd4j 多租户底座）|

---

## 架构

openclaw-plugins 采用**五层架构模型**：

```
第五层 — 业务应用       SCRM、仪表盘、数据分析
第四层 — 路由 + 桥接    规则引擎、消息转发、审计、跨渠道上下文
第三层 — OpenClaw Agent 每租户/每功能，各自绑定 memory + knowledge + tools
第二层 — AI 能力        Knowledge/RAG · Memory L0-L3 · Tracing · OAuth2
第一层 — 渠道层        IM（5 自建 + 21 桥接）· MQ（8 协议桥接）
```

**核心设计原则**：绝不修改渠道代码。router 和 bridge 插件位于所有渠道外部，通过监听 `agent_end` 和 `before_prompt_build` 事件实现跨渠道消息路由和上下文注入。

---

## 官方上游

以下 IM 渠道由平台官方团队维护，通过 `@partme.ai/openclaw-bridge` 接入 PartMe.AI 生态 — **无需本地 fork**：

| 平台 | 官方插件 | 仓库 | 文档 |
|------|---------|------|------|
| 钉钉 | `@dingtalk-real-ai/dingtalk-connector` | [DingTalk-Real-AI/dingtalk-openclaw-connector](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector) | [dws CLI](https://github.com/DingTalk-Real-AI/dingtalk-workspace-cli) |
| 飞书/Lark | `@larksuite/openclaw-lark` | [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) | [官方文档](https://bytedance.larkoffice.com/docx/MFK7dDFLFoVlOGxWCv5cTXKmnMh) |
| QQ | `@tencent-connect/openclaw-qqbot` | [tencent-connect/openclaw-qqbot](https://github.com/tencent-connect/openclaw-qqbot) | — |

### Bundled 渠道（18 个）

以下渠道随 OpenClaw 内置，通过 `@partme.ai/openclaw-bridge` 配置即可接入，无需额外安装：

`discord` `slack` `telegram` `whatsapp` `signal` `line` `matrix` `irc` `msteams` `googlechat` `imessage` `mattermost` `nextcloud-talk` `nostr` `zalo` `twitch` `tlon` `synology-chat`

详见 [@partme.ai/openclaw-bridge](./extensions/bridge)。

---

## 快速开始

### 环境要求

- **Node.js** >= 22.0.0 · **pnpm** >= 9 · **OpenClaw** >= 2026.4.12

### 安装插件

```bash
# 自建 IM 渠道
openclaw plugins install @partme.ai/wecom

# 官方上游（需单独安装）
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
openclaw plugins install @larksuite/openclaw-lark
openclaw plugins install @tencent-connect/openclaw-qqbot

# 桥接适配（统一接入所有渠道）
openclaw plugins install @partme.ai/openclaw-bridge

# 基础设施 & AI 能力
openclaw plugins install @partme.ai/openclaw-knowledge
openclaw plugins install @partme.ai/openclaw-prometheus
```

### 开发

```bash
git clone https://github.com/partme-ai/openclaw-plugins.git
cd openclaw-plugins
pnpm install

pnpm build         # 构建全部
pnpm typecheck     # 类型检查全部

cd extensions/wecom
pnpm dev           # 监视模式
pnpm test:watch    # 测试监视模式

pnpm new-plugin <name> --label "显示名称" --desc "描述"
```

---

## 插件开发

所有插件遵循 [插件规范](./spec/PLUGIN_SPEC.md)。每个插件：

| 文件 | 用途 |
|------|------|
| `index.ts` | 插件入口：默认导出 `id`, `name`, `configSchema`, `register(api)` |
| `openclaw.plugin.json` | 清单：渠道所有权、配置 schema、契约、激活提示 |
| `package.json` | npm 元数据：`@partme.ai/<name>`, `type: "module"`, `openclaw` 块 |
| `src/channel.ts` | ChannelPlugin 实现（渠道插件） |
| `src/config.ts` | Zod schema 运行时验证 |
| `src/runtime.ts` | 运行时状态单例 |
| `src/monitor.ts` | 消息去重（60s TTL, 10K 上限）+ webhook 处理 |
| `src/media.ts` | 媒体加载：`detectMediaType`, `loadMedia`, `downloadMedia` |

### 入口模式

```typescript
// 模式 A: 直接对象导出（大多数插件）
const plugin = { id, name, configSchema, register(api) { ... } };
export default plugin;

// 模式 B: defineChannelPluginEntry 包装（wechat 等）
export default defineChannelPluginEntry({ id, plugin, setRuntime });

// 模式 C: src/ 重导出（基础设施 & 平台插件）
export { default } from "./src/index.js";
```

### 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js 22+ (ESM) |
| 语言 | TypeScript 5.x (strict) |
| 包管理 | pnpm 9 (workspaces) |
| 构建 | tsup (ES2022) / tsc |
| 测试 | Vitest 4.x |
| 配置校验 | Zod 4.x |
| 版本 | `YYYY.M.D` (活跃) / semver (稳定) |

---

## CI/CD

| 工作流 | 文件 | 说明 |
|--------|------|------|
| CI | `.github/workflows/ci.yml` | 按变更插件矩阵构建 |
| Nacos | `.github/workflows/build-nacos.yml` | Nacos 独立严格构建 |
| 发布 | `.github/workflows/publish.yml` | 手动触发，默认 dry-run |

```bash
node scripts/publish-changed.mjs --dry-run           # 预览
node scripts/publish-changed.mjs --plugin wecom       # 发布单个
node scripts/publish-changed.mjs                      # 发布全部有变更的
node scripts/publish-changed.mjs --plugin wecom --tag next  # 预发布
```

---

## 许可证

各插件按各自许可证发布。核心基础设施和自建插件：**MIT License**。

**Made with ❤️ by PartMe.AI Team**

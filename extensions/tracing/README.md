# OpenClaw 追踪

**OpenClaw 插件 — 分布式追踪消息流和智能体交互**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--tracing-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.md) | [简体中文](./README_CN.md)

---

## 📖 简介

`@partme.ai/openclaw-tracing` 是一个为 [OpenClaw](https://github.com/openclaw/openclaw) 设计的**分布式追踪插件**，用于捕获消息流、智能体交互和工具调用的完整追踪链。灵感来自 rabbitmq_tracing，它使用兼容 OpenTelemetry 的数据模型，并支持多种后端存储追踪数据。

---

## 🎯 核心功能

- **完整追踪链**：捕获从消息到达 → 智能体处理 → 工具调用 → 响应的完整生命周期
- **多种后端**：支持日志 / 文件（JSONL + 每日轮转）/ OTLP HTTP 后端
- **采样控制**：基于 traceId 哈希的确定性采样
- **隐私保护**：可选的消息体捕获
- **HTTP API**：通过 REST 端点查询最近的追踪数据
- **Hook 集成**：自动追踪 `command:new`、`tool_result_persist` 和 `agent:bootstrap` 事件
- **会话隔离**：遵循 OpenClaw 全局 `session.dmScope` 配置，确保会话追踪的一致性

---

## 🏗️ 工作原理

### 追踪数据模型

项目采用 [OpenTelemetry Span 模型](src/types.ts)：

```
Trace (追踪)
  └── Span (跨度)
        ├── traceId      # 全局追踪 ID，关联所有相关 Span
        ├── spanId       # 当前操作 ID
        ├── parentSpanId  # 父 Span ID（构建调用链）
        ├── name         # 操作名称
        ├── kind         # Span 类型 (server/internal/client)
        ├── startTimeMs  # 开始时间
        ├── endTimeMs    # 结束时间
        ├── attributes    # 键值属性
        └── events       # 时间点事件
```

### 追踪流程

```
消息到达 → command:new → agent:bootstrap → tool:xxx → 响应
    ↓            ↓              ↓              ↓
 [Root Span] [Agent Span]  [Tool Span]  [完成导出]
```

参考 [hooks.ts](src/hooks.ts) 中的三个核心事件钩子：

| 事件 | 创建的 Span | 类型 |
|------|------------|------|
| `command:new` | 消息到达根 Span | server |
| `agent:bootstrap` | 智能体处理 Span | internal |
| `tool_result_persist` | 工具调用 Span | client |

### 会话隔离策略

插件使用 OpenClaw 的全局 `session.dmScope` 配置进行会话隔离，参考 [dm-scope.ts](src/dm-scope.ts)：

| dmScope | 会话键格式 | 说明 |
|---------|----------|------|
| `main` | `agent:agentId:main` | 所有交互共享一个会话 |
| `per-peer` | `agent:agentId:direct:peerId` | 每个对等方独立会话 |
| `per-channel-peer` | `agent:agentId:channel:direct:peerId` | 通道+对等方会话隔离 |
| `per-account-channel-peer` | `agent:agentId:channel:accountId:direct:peerId` | 账户+通道+对等方隔离 |

这与 `openclaw-mqtt`、`openclaw-web-mqtt`、`openclaw-stomp`、`openclaw-web-stomp` 等插件保持一致。

### 追踪后端

项目支持三种后端存储，参考 [backends/](src/backends/) 目录：

| 后端 | 配置值 | 说明 |
|------|--------|------|
| **Log** | `backend: "log"` | 输出到控制台 JSON 格式 |
| **File** | `backend: "file"` | JSONL 文件 + 每日轮转 |
| **OTLP** | `backend: "otlp"` | 推送到支持 OTLP 的后端服务 |

### 采样机制

参考 [sampler.ts](src/sampler.ts)：

- 使用**确定性采样**：相同 `traceId` 始终产生相同采样结果
- 基于 `traceId` 哈希值与 `sampleRate` 比较
- 配置范围：`0.0`（全拒绝）~ `1.0`（全采样）

---

## 🚀 快速开始

### 先决条件

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-tracing
```

### 最小配置 (`openclaw.json`)

```json
{
  "tracing": {
    "enabled": true,
    "backend": "log",
    "sampleRate": 1.0,
    "captureMessageBody": false
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

### 完整配置选项

```json
{
  "tracing": {
    "enabled": true,
    "backend": "file",
    "otlpEndpoint": "http://localhost:4318",
    "sampleRate": 0.5,
    "traceDir": "./traces",
    "maxSpansPerTrace": 100,
    "captureMessageBody": true
  }
}
```

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | false | 是否启用追踪 |
| `backend` | string | "log" | 后端类型：log/file/otlp |
| `otlpEndpoint` | string | "http://localhost:4318" | OTLP HTTP 端点 |
| `sampleRate` | number | 1.0 | 采样率 0.0~1.0 |
| `traceDir` | string | "./traces" | 文件后端存储目录 |
| `maxSpansPerTrace` | number | 100 | 单个追踪最大 Span 数 |
| `captureMessageBody` | boolean | false | 是否捕获消息体 |

---

## 📍 HTTP 端点

| 端点 | 方法 | 描述 |
| -------- | ------ | ----------- |
| `/tracing/status` | GET | 追踪状态和配置 |
| `/tracing/traces` | GET | 最近追踪列表（支持 `?limit=N` 参数） |
| `/tracing/trace` | GET | 详细追踪信息（需要 `?traceId=xxx` 参数） |

---

## 📁 项目结构

```
openclaw-tracing/
├── src/
│   ├── index.ts              # 插件入口点
│   ├── hooks.ts              # 网关事件钩子
│   ├── sampler.ts            # 追踪采样器
│   ├── dm-scope.ts           # 基于 dmScope 的会话隔离
│   ├── types.ts              # 类型定义
│   ├── backends/
│   │   ├── log-backend.ts    # 日志后端
│   │   ├── file-backend.ts   # 文件后端 (JSONL)
│   │   └── otlp-backend.ts   # OTLP HTTP 后端
│   └── openclaw-sdk.d.ts     # OpenClaw SDK 类型
├── .github/workflows/
│   ├── ci.yml               # CI 工作流
│   └── release.yml           # 发布工作流
├── openclaw.plugin.json       # 插件清单
├── package.json
└── README.md / README_CN.md
```

---

## 🧪 测试

### 单元测试

```bash
npm test
```

### 测试覆盖率

```bash
npm run test:coverage
```

---

## 🤖 GitHub Actions

| 工作流 | 触发条件 | 目的 |
| --- | --- | --- |
| `.github/workflows/ci.yml` | 推送到 `main` 或 `master` / PR | 安装、类型检查、构建、测试、上传 `dist/` |
| `.github/workflows/release.yml` | 标签 `v*` / 手动触发 | 构建、测试、发布 npm 包 |

---

## 📦 发布

- 包名: `@partme.ai/openclaw-tracing`
- 必需密钥: `NPM_TOKEN`

标签发布示例:

```bash
npm version patch
git push origin main --follow-tags
```

---

## OpenClaw 文档

插件、SDK 和相关主题的官方文档：

### 插件

- [工具 — 插件](https://docs.openclaw.ai/tools/plugin)
- [社区插件](https://docs.openclaw.ai/plugins/community)
- [捆绑包](https://docs.openclaw.ai/plugins/bundles)

### 构建插件

- [构建插件](https://docs.openclaw.ai/plugins/building-plugins)
- [SDK 概览](https://docs.openclaw.ai/plugins/sdk-overview)
- [SDK 入口点](https://docs.openclaw.ai/plugins/sdk-entrypoints)
- [SDK 运行时](https://docs.openclaw.ai/plugins/sdk-runtime)

---

## ❓ 常见问题

### 会话隔离如何工作？

插件使用 OpenClaw 的全局 `session.dmScope` 配置生成一致的会话键，确保追踪数据根据您所需的作用域正确隔离。

### 我可以将其与外部可观测性系统一起使用吗？

是的，OTLP 后端允许您将追踪数据导出到 Jaeger、Zipkin 或 Prometheus 等系统。

### 如何控制追踪采样？

在配置中设置 `sampleRate` 在 0.0 到 1.0 之间，以控制捕获的追踪比例。

### 消息体隐私如何保护？

设置 `captureMessageBody: false`（默认）可避免捕获消息内容，仅记录元数据。

---

## 📄 许可证

MIT
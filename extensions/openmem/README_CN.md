# @partme.ai/openclaw-openmem（OpenMem 记忆桥接插件）

> OpenMem 本地优先记忆桥接插件 — 通过 `/inspect/search` 实现混合检索召回，通过 `/events/ingest` 实现事件摄取。

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--openmem-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-openmem)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## 概述

`@partme.ai/openclaw-openmem` 桥接 OpenClaw Agent 到本地 [OpenMem](https://github.com/partme-ai) 记忆服务器。它实现了 OpenClaw Memory Host SDK，声明 `kind: "memory"`，提供：

- **召回**：`MemorySearchManager.search` 委托到 `POST /inspect/search`（混合模式）
- **摄取**：在 `agent_end` 事件上将对话消息发送到 `POST /events/ingest`
- **工具**：Agent 可通过 `openmem_search` 工具搜索 OpenMem 记忆

OpenMem 设计为 HTTP 旁路服务（默认端口 **3317**），与 OpenClaw Gateway 并行运行，提供本地优先的混合搜索记忆后端。

## 特性

- **HTTP 旁路架构** — OpenMem 作为独立服务器在端口 3317 上运行
- **混合搜索召回** — 通过 `POST /inspect/search` 进行记忆搜索（混合模式）
- **Agent 结束摄取** — 在 `agent_end` 事件上自动进行记忆摄取
- **`openmem_search` 工具** — Agent 可显式搜索外部化记忆
- **Memory Host SDK 兼容** — 实现 `MemorySearchManager` 接口，框架自动召回
- **零内部存储** — 所有记忆数据由 OpenMem 旁路服务管理
- **可配置** — 可配置 `baseUrl` 和 `maxSearchResults`

## 快速开始

### 1. 启动 OpenMem 旁路服务

```bash
cd OpenMem
pnpm install
pnpm --filter @openmem/server dev
# 服务启动于 http://127.0.0.1:3317
```

验证服务运行：

```bash
curl -s http://127.0.0.1:3317/healthz
# → { "status": "ok" }
```

### 2. 安装插件

```bash
openclaw plugins install @partme.ai/openclaw-openmem
```

### 3. 配置

```json
{
  "plugins": {
    "entries": {
      "openmem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3317"
        }
      }
    }
  }
}
```

## 配置参考

```jsonc
{
  "plugins": {
    "entries": {
      "openmem": {
        "enabled": true,
        "config": {
          "baseUrl": "http://127.0.0.1:3317",   // OpenMem 旁路服务 URL
          "maxSearchResults": 10                  // 每次搜索返回的最大结果数（默认 10）
        }
      }
    }
  }
}
```

| 字段 | 类型 | 默认值 | 描述 |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | 启用 OpenMem 插件 |
| `baseUrl` | string | `"http://127.0.0.1:3317"` | OpenMem 旁路服务基础 URL |
| `maxSearchResults` | number | `10` | 每次搜索返回的最大结果数 |

## 行为说明

### 召回流程

```
Agent 需要记忆
    │
    ▼
OpenClaw 框架调用 MemorySearchManager.search(query)
    │
    ▼
插件发送 POST /inspect/search，参数 { query, mode: "hybrid", limit }
    │
    ▼
OpenMem 旁路服务执行混合搜索（向量 + 关键词）
    │
    ▼
结果以 MemorySearchResult[] 返回 → 注入到上下文
```

### 摄取流程

```
Agent 完成对话（agent_end 事件）
    │
    ▼
插件收集事件中的所有消息
    │
    ▼
插件发送 POST /events/ingest，携带所有消息
    │
    ▼
OpenMem 旁路服务将消息存储为记忆事件
```

### Agent 工具

Agent 可在对话中使用 `openmem_search` 工具：

```json
{
  "name": "openmem_search",
  "description": "通过 OpenMem 混合召回搜索外部化记忆。",
  "parameters": {
    "query": "string（必填）",
    "limit": "number（可选，默认 10，最大 20）"
  }
}
```

## 架构

```
┌─────────────────────┐     HTTP      ┌──────────────────────┐
│  OpenClaw Gateway   │ ◄──────────► │  OpenMem 旁路服务    │
│                     │              │  (端口 3317)         │
│  openclaw-openmem   │  /inspect/   │                      │
│  插件               │  search      │  混合搜索引擎         │
│                     │              │                      │
│  MemorySearchManager│  /events/    │  事件存储             │
│  .search()          │  ingest      │                      │
│                     │              │  向量 + 关键词索引    │
│  agent_end → 摄取   │              │                      │
└─────────────────────┘              └──────────────────────┘
```

## MVP 验收清单

| # | 步骤 | 命令 / 操作 |
|---|------|-----------------|
| 1 | 启动 OpenMem 旁路服务 | `cd OpenMem && pnpm install && pnpm --filter @openmem/server dev` |
| 2 | 健康检查 | `curl -s http://127.0.0.1:3317/healthz` → `{ "status": "ok" }` |
| 3 | 端到端冒烟测试 | `bash OpenMem/scripts/mvp-smoke.sh` |
| 4 | 安装插件 | `openclaw plugins install -l ./extensions/openmem` |
| 5 | 对话后召回 | 多轮对话 → agent_end 摄取 → 新会话使用 `openmem_search` 或自动召回 |

## 开发

```bash
# 安装依赖
cd extensions/openmem
pnpm install

# 运行测试
pnpm test

# 类型检查
pnpm typecheck
```

## 许可证

基于 [MIT License](LICENSE) 开源。

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) monorepo 的一员 — 由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合，包含 30+ 独立插件，覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

每个插件独立发布到 npm（`@partme.ai` scope），可单独安装：

```bash
openclaw plugins install @partme.ai/openclaw-openmem
```

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施，提供从企微/钉钉/飞书/QQ 渠道接入，到 RAG 知识库、多级记忆、监控运维的全栈解决方案。

> 联系我们：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

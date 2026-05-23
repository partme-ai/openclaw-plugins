# OpenClaw Memory

**OpenClaw 插件 — 多级长期记忆 (L0→L3)，自动召回**

[![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--memory-blue)](https://www.npmjs.com/package/@partme.ai/openclaw-memory)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

[简体中文](./README.md) | [English](./README.en.md)

---

## 概述

`@partme.ai/openclaw-memory` 为 OpenClaw Agent 提供多级长期记忆能力。它实现了 OpenClaw Memory Host SDK 契约，声明 `kind: "memory"` — 框架自动处理记忆召回、上下文注入和 flush 时机。插件仅负责存储（L0 录制）、提取（L1 关键词记忆）和搜索（通过 `MemorySearchManager`）。

**零外部依赖** — 数据存储在本地 JSONL 文件中，使用纯关键词匹配，无需外部数据库或 API。

## 架构

```
记忆层级架构：

L0 — 对话录制：自动捕获每轮对话到本地 JSONL 文件
L1 — 记忆提取：从对话中提取结构化关键词记忆
L2 — 场景归纳：基于 L1 记忆归纳场景块（通过 memory_search 工具）
L3 — 用户画像：生成/更新用户画像（通过 memory_search 工具）

自动召回：对话前自动搜索相关记忆并注入上下文
```

### 工作原理

1. **L0 录制**：每次 `agent_end` 事件结束时，所有对话消息追加到按日分割的 JSONL 文件中（`conversations/YYYY-MM-DD.jsonl`）
2. **L1 提取**：每第 5 次 `agent_end`，扫描用户消息提取关键词。包含足够关键词的消息记录为情景记忆（`records/YYYY-MM-DD.jsonl`）
3. **自动召回**：`MemorySearchManager.search()` 被 OpenClaw 框架在 `before_prompt_build` 期间自动调用 — 相关记忆自动注入对话上下文
4. **手动搜索**：Agent 可在对话中通过 `memory_search` 工具显式搜索记忆

## 特性

- **L0 对话录制** — 自动捕获每轮对话到本地 JSONL 文件
- **L1 关键词提取** — 从对话中提取结构化关键词记忆
- **自动召回** — 框架自动调用 `MemorySearchManager.search()` 注入相关记忆到上下文
- **关键词搜索** — 纯关键词匹配 + 评分（零外部 API 调用）
- **30 文件窗口扫描** — 搜索最近 30 个记录文件以寻找相关记忆
- **`memory_search` 工具** — Agent 可在对话中主动搜索用户记忆
- **保留管理** — 可配置的保留周期（默认 90 天）
- **纯本地运行** — 无外部依赖，无需 API 密钥，无需向量数据库
- **可配置** — 数据目录、搜索结果上限、保留天数均可配置

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-memory
```

### 最小配置

```json
{
  "plugins": {
    "entries": {
      "memory": {
        "enabled": true,
        "config": {
          "dataDir": "~/.openclaw/state/memory"
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
      "memory": {
        "enabled": true,
        "config": {
          "dataDir": "~/.openclaw/state/memory",   // 数据存储目录
          "maxSearchResults": 10,                   // 每次搜索最大结果数（默认 10）
          "retentionDays": 90                       // 数据保留天数（默认 90）
        }
      }
    }
  }
}
```

| 字段 | 类型 | 默认值 | 描述 |
|-------|------|---------|-------------|
| `enabled` | boolean | `true` | 启用记忆插件 |
| `dataDir` | string | `~/.openclaw/state/memory` | 数据存储目录 |
| `maxSearchResults` | number | `10` | 每次搜索返回的最大结果数 |
| `retentionDays` | number | `90` | 数据保留天数（参考值，不自动删除） |

## 记忆搜索工具

Agent 可在对话中使用 `memory_search` 工具主动搜索用户记忆：

```json
{
  "name": "memory_search",
  "label": "Memory Search",
  "description": "搜索用户的长期记忆。",
  "parameters": {
    "query": "搜索查询字符串",
    "limit": "最大结果数（默认 10，最大 20）"
  }
}
```

## 数据存储

### 目录结构

```
{dataDir}/
├── conversations/        # L0 对话日志（按日 JSONL 文件）
│   └── 2026-05-22.jsonl
└── records/              # L1 提取的记忆（按日 JSONL 文件）
    └── 2026-05-22.jsonl
```

### 对话记录格式（L0）

```json
{
  "id": "1747891234567_a1b2c3d4",
  "role": "user",
  "content": "退款政策是什么？",
  "timestamp": 1747891234567,
  "sessionKey": "session_abc123"
}
```

### 记忆记录格式（L1）

```json
{
  "id": "1747891234567_e5f6g7h8",
  "content": "用户提到：退款、政策、退货。退款政策是什么？",
  "type": "episodic",
  "sessionKey": "session_abc123",
  "createdAt": "2026-05-22T10:00:00.000Z"
}
```

## 范围与限制

- **存储**：仅支持本地 JSONL 文件，不适合分布式/集群部署
- **搜索**：纯关键词匹配 + 中文二元分词。不支持语义/向量搜索
- **性能**：扫描最近 30 个记录文件，性能受文件大小影响
- **提取频率**：默认每第 5 次对话进行记忆提取（可通过 `shouldExtract()` 配置）
- **Memory Host SDK**：实现了标准的 `MemorySearchManager` 接口，框架负责注入时机

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 运行测试
pnpm test

# 监听模式
pnpm dev

# 类型检查
pnpm typecheck
```

## 许可证

基于 [MIT License](LICENSE) 开源。

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) monorepo 的一员 — 由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合，包含 30+ 独立插件，覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

每个插件独立发布到 npm（`@partme.ai` scope），可单独安装：

```bash
openclaw plugins install @partme.ai/openclaw-memory
```

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施，提供从企微/钉钉/飞书/QQ 渠道接入，到 RAG 知识库、多级记忆、监控运维的全栈解决方案。

> 联系我们：partmeai@gmail.com | [GitHub](https://github.com/partme-ai/openclaw-plugins)

# Memory（长期记忆系统）

**OpenClaw 插件 — 多级长期记忆 (L0→L3)，自动召回**

\![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--memory-blue)
\![Node](https://img.shields.io/badge/Node.js-22+-green)
\![License](https://img.shields.io/badge/License-MIT-green)

[简体中文](./README.md) | [English](./README.en.md)

## 简介

openclaw-memory（`@partme.ai/openclaw-memory`）为 OpenClaw Agent 提供多级长期记忆能力。

### 架构

```
L0 — 对话录制：自动捕获每轮对话到本地 JSONL
L1 — 记忆提取：从对话中提取结构化关键词记忆
L2 — 场景归纳：基于 L1 记忆归纳场景块
L3 — 用户画像：生成/更新用户画像

Auto-Recall: 对话前自动注入相关记忆到上下文
```

### 核心能力

- **自动捕获**：每次对话结束后自动录制
- **记忆召回**：对话开始前自动搜索相关记忆并注入上下文
- **工具调用**：Agent 可通过 `memory_search` 工具主动搜索记忆
- **零外部依赖**：纯本地 JSONL 存储，不依赖外部 API

## 快速开始

```bash
openclaw plugins install @partme.ai/openclaw-memory
```

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) monorepo 的一员。

> 📧 联系我们：partmeai@gmail.com | 🦞 [GitHub](https://github.com/partme-ai/openclaw-plugins)

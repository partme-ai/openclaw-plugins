# Message Router（消息路由引擎）

**OpenClaw 插件 — 企业级跨渠道消息路由，知识库/记忆自动注入**

\![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--router-blue)
\![Node](https://img.shields.io/badge/Node.js-22+-green)
\![License](https://img.shields.io/badge/License-MIT-green)

[简体中文](./README.md) | [English](./README.en.md)

## 简介

openclaw-router（`@partme.ai/openclaw-router`）是 OpenClaw 的企业级消息路由引擎。

### 核心能力

- **消息多路分发**：IM 渠道消息自动转发到 MQ；MQ 消息回复到 IM 渠道
- **知识库自动注入**：每次对话前自动搜索 RAG 知识库，注入上下文
- **记忆自动注入**：自动召回用户历史记忆
- **纯配置驱动**：路由规则通过 JSON 配置，无需修改渠道插件代码
- **审计日志**：可选的消息审计追踪

## 快速开始

```bash
openclaw plugins install @partme.ai/openclaw-router
```

```json
{
  "router": {
    "enabled": true,
    "rules": [
      {
        "id": "wecom-to-mqtt",
        "match": { "channels": ["wecom"] },
        "actions": [
          { "type": "forward", "target": "mqtt", "topic": "openclaw/audit/wecom" }
        ]
      }
    ],
    "knowledge": { "autoInject": true, "maxResults": 5 },
    "memory": { "autoInject": true, "maxResults": 5 }
  }
}
```

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins) monorepo 的一员 — 一个由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合。

> 📧 联系我们：partmeai@gmail.com | 🦞 [GitHub](https://github.com/partme-ai/openclaw-plugins)

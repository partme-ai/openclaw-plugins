# 高德地图（Amap）

**OpenClaw 插件 — 高德开放平台渠道与运营工具，公域 Agent-First 智能运营**

\![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--amap-blue)
\![Node](https://img.shields.io/badge/Node.js-22+-green)
\![License](https://img.shields.io/badge/License-MIT-green)

[简体中文](./README.md) | [English](./README.en.md)

## 简介

高德地图（`@partme.ai/openclaw-amap`）是 [OpenClaw](https://github.com/openclaw/openclaw) 的渠道插件，集成高德开放平台 Web 服务 API，提供 POI 搜索、周边查询、地点详情等工具。

### 核心能力

- `amap_query_poi` — POI 关键词搜索
- `amap_query_around` — 周边搜索
- `amap_place_detail` — 地点详情查询

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-amap
```

### 配置

```json
{
  "channels": {
    "amap": {
      "enabled": true,
      "key": "your-amap-web-api-key",
      "poi_id": "your-poi-id"
    }
  }
}
```

## 关于 openclaw-plugins

本项目是 [openclaw-plugins](https://github.com/partme-ai/openclaw-plugins)  monorepo 的一员 — 一个由 **PartMe.AI 团队** 研发与二次开发的 OpenClaw 企业级插件集合，包含 30+ 独立插件，覆盖 IM 渠道、消息队列、AI 能力、基础设施四大领域。

每个插件独立发布到 npm（`@partme.ai` scope），可单独安装：

```bash
openclaw plugins install @partme.ai/openclaw-nacos
```

**PartMe.AI** 专注于 AI 智能客服与企业级 AI Agent 基础设施，提供从企微/钉钉/飞书/QQ 渠道接入，到 RAG 知识库、多级记忆、监控运维的全栈解决方案。

> 📧 联系我们：partmeai@gmail.com | 🦞 [GitHub](https://github.com/partme-ai/openclaw-plugins)

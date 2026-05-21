# 统一消息格式 SDK

**零依赖纯类型定义 — openclaw-plugins 所有渠道插件的互通消息标准**

[简体中文](./README.md) | [English](./README.en.md)

## 简介

`@partme.ai/openclaw-message-sdk` 定义了 openclaw-plugins 生态中的统一消息格式。所有渠道插件（IM、MQ、Gotify 等）使用此格式进行跨渠道路由和互通。

### 核心设计

- **消息体不含文件二进制数据**，只包含文件 URL/路径引用
- **图片可选 base64** 内联（小图场景）
- 支持 `text` / `markdown` / `mixed` 三种内容类型
- `traceId` 全链路追踪

### 安装

```bash
npm install @partme.ai/openclaw-message-sdk
```

### 使用

```typescript
import { buildMessage, createImageRef, UnifiedMessage } from "@partme.ai/openclaw-message-sdk";

const msg = buildMessage({
  channel: "wecom",
  accountId: "default",
  userId: "user_zhangsan",
  text: "请查看这张图片",
  media: [createImageRef("https://cdn.example.com/img.png", "base64data...", "img.png")],
});

// 序列化为 JSON（MQ 传输用）
const json = JSON.stringify(msg);
```

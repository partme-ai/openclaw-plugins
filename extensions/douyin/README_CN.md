# 抖音开放平台

> **OpenClaw 插件 -- 抖音开放平台渠道与运营工具，公域 Agent-First 智能运营**

[![npm](https://img.shields.io/npm/v/@partme.ai/openclaw-douyin)](https://www.npmjs.com/package/@partme.ai/openclaw-douyin)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E=2026.4.12-blueviolet)](https://github.com/partme-ai/openclaw)

[简体中文](./README.md)

## 简介

`@partme.ai/openclaw-douyin` 是 OpenClaw 的渠道插件，集成抖音开放平台（生活服务商家应用），提供 Webhook 事件入站、client_token 鉴权与店铺运营工具。

插件支持多账号混合配置，每个账号独立注册 Gateway Webhook 路由，入站消息通过 `dispatchInboundDirectDmWithRuntime` 派发至 Agent 管线。

### 核心能力

- **渠道通道** `douyin` -- 基于 `createChatChannelPlugin` 的完整渠道生命周期（start/stop/inbound/outbound）
- **Gateway Webhook** -- 每个账号在 Gateway 上注册独立 HTTP 路由（`auth: "plugin"`），支持 SHA1 签名验签与 `verify_webhook` 挑战应答
- **client_token 鉴权** -- 自动获取 `client_credential` grant_type 的 access_token，用于生活服务 OpenAPI 调用
- **消息去重** -- 基于 `msg-id` 请求头的内存去重（最大 1000 条，先进先出淘汰）
- **入站派发** -- 校验签名后通过 SDK 将事件写为 Direct DM 消息，驱动 Agent 响应
- **多账号支持** -- 支持 `channels.douyin` 顶层配置与 `accounts.<id>` 多账号覆盖，自动解析合并

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-douyin
```

## 配置

安装后在 `openclaw.json` 的 `channels.douyin` 中配置凭据与 Webhook 参数。

### 单账号配置

```jsonc
{
  "channels": {
    "douyin": {
      "enabled": true,
      "app_key": "your_client_key",
      "app_secret": "your_client_secret",
      "shop_id": "your_shop_id",
      "webhook_path": "/channels/douyin/webhook",
      "callback_url": "https://your-domain.com/channels/douyin/webhook",
      "dmPolicy": "open",
      "allowFrom": []
    }
  }
}
```

### 多账号配置

```jsonc
{
  "channels": {
    "douyin": {
      "enabled": true,
      "app_key": "default_client_key",
      "app_secret": "default_client_secret",
      "webhook_path": "/channels/douyin/webhook",
      "accounts": {
        "shop2": {
          "app_key": "shop2_client_key",
          "app_secret": "shop2_client_secret",
          "shop_id": "shop2_id",
          "webhook_path": "/channels/douyin/webhook-shop2"
        }
      }
    }
  }
}
```

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `DOUYIN_APP_KEY` | 抖音开放平台 client_key |
| `DOUYIN_APP_SECRET` | 抖音开放平台 client_secret |

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | `boolean` | `true` | 是否启用该渠道 |
| `app_key` | `string` | -- | 抖音开放平台 client_key |
| `app_secret` | `string` | -- | 抖音开放平台 client_secret |
| `shop_id` | `string` | -- | 店铺 / POI ID（单店铺） |
| `webhook_path` | `string` | `/channels/douyin/webhook` | Gateway Webhook 路由路径 |
| `callback_url` | `string` | -- | 在抖音开放平台配置的回调 URL |
| `dmPolicy` | `string` | `"open"` | DM 安全策略：`open` / `allowlist` / `pairing` / `disabled` |
| `allowFrom` | `string[]` | `[]` | DM 白名单（配合 `allowlist` 策略使用） |

## 工具列表

| 工具名称 | 说明 | 主要参数 |
|----------|------|---------|
| `douyin_query_orders` | 查询抖音订单列表 | `date_from`, `date_to`, `status`, `page`, `page_size` |
| `douyin_reply_review` | 回复抖音店铺评价 | `review_id`, `content` |
| `douyin_query_shop_metrics` | 查询店铺经营指标 | `date_from`, `date_to` |

工具通过 `client_token` 鉴权调用抖音生活服务 OpenAPI，运行时自动获取 access_token。

## 架构说明

### Webhook 入站流程

```
抖音开放平台 Webhook
  --> Gateway HTTP 路由 (/channels/douyin/webhook)
    --> SHA1 签名验签 (app_secret + rawBody)
      --> verify_webhook 挑战应答
        --> msg-id 去重
          --> dispatchInboundDirectDmWithRuntime
            --> Agent 管线处理
```

### 鉴权流程

```
插件启动
  --> 读取 channels.douyin 配置
    --> 调用 POST /oauth/client_token/ (client_credential)
      --> 获取 access_token
        --> 携带 access_token 调用生活服务 OpenAPI
```

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 类型检查
pnpm typecheck

# 运行测试
pnpm test
```

## 许可

MIT License

---

**PartMe.AI** -- 专注于 AI 智能客服与企业级 AI Agent 基础设施

[联系我们](mailto:partmeai@gmail.com) | [GitHub](https://github.com/partme-ai/openclaw-plugins)

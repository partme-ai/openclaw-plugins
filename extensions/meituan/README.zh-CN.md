# 美团开放平台

> **OpenClaw 插件 -- 美团开放平台渠道与运营工具，公域 Agent-First 智能运营**

[![npm](https://img.shields.io/npm/v/@partme.ai/openclaw-meituan)](https://www.npmjs.com/package/@partme.ai/openclaw-meituan)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E=2026.4.12-blueviolet)](https://github.com/partme-ai/openclaw)

[简体中文](./README.md)

## 简介

`@partme.ai/openclaw-meituan` 是 OpenClaw 的渠道插件，集成美团开放平台，提供 Webhook 事件回调接收、HMAC-SHA256 签名验签以及店铺运营工具，实现公域 Agent-First 智能运营。

插件将美团开放平台的订单、评价、经营数据等事件通过 Webhook 入站，驱动 Agent 自动化处理，并提供运营工具供 Agent 主动调用美团 Open API。

### 核心能力

- **渠道通道** `meituan` -- 完整渠道生命周期，配置 `channels.meituan`
- **Webhook 回调** -- 注册 `POST /channels/meituan/webhook` 路由，接收美团事件推送
- **HMAC-SHA256 验签** -- 使用 `timingSafeEqual` 常量时间比较，防止时序攻击
- **签名鉴权调用** -- 调用美团 Open API 时使用 HMAC-SHA256 对请求参数排序签名
- **PluginConfig 覆盖** -- 支持宿主注入 `pluginConfig` 与 `channels.meituan` 浅合并覆盖
- **5 个运营工具** -- 覆盖订单查询、评价回复、经营指标、团购核销、店铺二维码

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-meituan
```

## 配置

安装后在 `openclaw.json` 的 `channels.meituan` 中配置凭据与回调 URL。

### 单店铺配置

```jsonc
{
  "channels": {
    "meituan": {
      "enabled": true,
      "app_key": "your_app_key",
      "app_secret": "your_app_secret",
      "shop_id": "your_shop_id",
      "webhook_secret": "your_webhook_secret"
    }
  }
}
```

### 多店铺配置

```jsonc
{
  "channels": {
    "meituan": {
      "enabled": true,
      "app_key": "default_app_key",
      "app_secret": "default_app_secret",
      "accounts": {
        "shop2": {
          "app_key": "shop2_app_key",
          "app_secret": "shop2_app_secret",
          "shop_id": "shop2_id"
        }
      }
    }
  }
}
```

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `MEITUAN_APP_KEY` | 美团开放平台 AppKey |
| `MEITUAN_APP_SECRET` | 美团开放平台 AppSecret |
| `MEITUAN_API_BASE` | 美团 API 地址（默认 `https://api.meituan.com`） |

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `app_key` | `string` | -- | 美团开放平台应用的 AppKey |
| `app_secret` | `string` | -- | 美团开放平台应用的 AppSecret |
| `shop_id` | `string` | -- | 店铺 ID（单店铺场景） |
| `callback_url` | `string` | -- | 在美团开放平台配置的回调地址 |
| `webhook_secret` | `string` | -- | Webhook 验签密钥（默认使用 `app_secret`） |

## 工具列表

| 工具名称 | 说明 | 主要参数 |
|----------|------|---------|
| `meituan_query_orders` | 查询美团订单列表，支持按日期、状态筛选 | `date_from`, `date_to`, `status`, `page`, `page_size` |
| `meituan_reply_review` | 回复美团店铺评价 | `review_id`, `content` |
| `meituan_query_shop_metrics` | 查询店铺经营指标 | `date_from`, `date_to` |
| `meituan_verify_writeoff` | 团购核销：核销订单 / 核销码 | `order_id`, `verify_code` |
| `meituan_shop_qrcode` | 获取店铺二维码 | `shop_id`, `scene` |

所有工具调用美团 Open API 时自动完成参数排序、HMAC-SHA256 签名、timestamp 注入。

## 架构说明

### Webhook 入站流程

```
美团开放平台事件推送
  --> POST /channels/meituan/webhook
    --> HMAC-SHA256 验签 (X-Meituan-Signature / X-Signature)
      --> 解析事件 body（event_type、shop_id）
        --> publishInbound → Agent 管线处理
```

### 验签规则

- 签名头名称：`X-Meituan-Signature` 或 `X-Signature`
- 算法：`HMAC-SHA256(body, secret)`
- Secret 优先级：`webhook_secret` > `app_secret`
- 使用 `crypto.timingSafeEqual` 进行常量时间比较

### API 调用签名

```text
1. 收集参数（含 app_key、timestamp）
2. 按 key 字母排序
3. 拼接为 key1=value1&key2=value2
4. HMAC-SHA256(拼接字符串, app_secret) → sign
5. 将 sign 加入请求参数
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

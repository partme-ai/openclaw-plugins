# RedNode（小红书）

> **OpenClaw 插件 -- 小红书开放平台渠道与运营工具，公域 Agent-First 智能运营**

[![npm](https://img.shields.io/npm/v/@partme.ai/openclaw-rednode)](https://www.npmjs.com/package/@partme.ai/openclaw-rednode)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E=2026.4.12-blueviolet)](https://github.com/partme-ai/openclaw)

[简体中文](./README.md)

## 简介

`@partme.ai/openclaw-rednode`（品牌名 RedNode，渠道 ID 为 `xhs`）是 OpenClaw 的渠道插件，集成小红书开放平台，提供 Webhook 事件回调接收、HMAC-SHA256 签名验签以及店铺运营工具。

插件支持**直连模式**（直接调用小红书 Open API）和**多租户底座模式**（通过 `ddd4j-rednote` 底座代理调用），灵活适配不同部署架构。

### 核心能力

- **渠道通道** `xhs` -- 完整渠道生命周期，配置 `channels.xhs`
- **Webhook 回调** -- 注册 `POST /channels/xhs/webhook` 路由，接收小红书事件推送
- **HMAC-SHA256 验签** -- 使用 `timingSafeEqual` 常量时间比较验签，防止时序攻击
- **双模式鉴权** -- 直连模式（app_id + app_secret）与多租户底座模式（ddd4j_api_base + ddd4j_api_key）
- **入站事件映射** -- 解析 event_type、shop_id/seller_id 后驱动 Agent 管线
- **6 个运营工具 + 经营概览聚合** -- 覆盖订单、售后、商品管理与运营日报

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-rednode
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

## 配置

安装后在 `openclaw.json` 的 `channels.xhs` 中配置凭据与回调 URL。

### 直连模式（推荐单店铺）

```jsonc
{
  "channels": {
    "xhs": {
      "enabled": true,
      "app_id": "your_app_id",
      "app_secret": "your_app_secret",
      "shop_id": "your_shop_id",
      "webhook_secret": "your_webhook_secret"
    }
  }
}
```

### 多租户底座模式

```jsonc
{
  "channels": {
    "xhs": {
      "enabled": true,
      "app_id": "tenant_app_id",
      "ddd4j_api_base": "https://your-base-service/ddd4j-rednote",
      "ddd4j_api_key": "platform_issued_api_key",
      "shop_id": "your_shop_id"
    }
  }
}
```

### 多店铺配置

```jsonc
{
  "channels": {
    "xhs": {
      "enabled": true,
      "app_id": "default_app_id",
      "app_secret": "default_app_secret",
      "accounts": {
        "shop2": {
          "app_id": "shop2_app_id",
          "app_secret": "shop2_app_secret",
          "shop_id": "shop2_id",
          "seller_id": "shop2_seller_id"
        }
      }
    }
  }
}
```

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `XHS_APP_KEY` | 小红书开放平台 App ID |
| `XHS_APP_SECRET` | 小红书开放平台 App Secret |
| `XHS_API_BASE` | 小红书 API 地址（默认 `https://open.xiaohongshu.com`） |

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `app_id` | `string` | -- | 小红书开放平台的应用 ID |
| `app_secret` | `string` | -- | 直连模式：小红书 AppSecret |
| `shop_id` | `string` | -- | 店铺 ID |
| `seller_id` | `string` | -- | 卖家 ID |
| `callback_url` | `string` | -- | 应用推送回调 URL |
| `webhook_secret` | `string` | -- | 独立 Webhook 验签密钥（默认使用 `app_secret`） |
| `ddd4j_api_base` | `string` | -- | 多租户底座模式：底座服务根地址 |
| `ddd4j_api_key` | `string` | -- | 多租户底座模式：平台颁发的 API Key |

## 工具列表

| 工具名称 | 说明 | 主要参数 |
|----------|------|---------|
| `xhs_query_orders` | 查询小红书订单列表 | `start_time`, `end_time`, `order_status`, `page`, `page_size` |
| `xhs_query_order_detail` | 查询小红书订单详情 | `order_id` |
| `xhs_query_refunds` | 查询售后 / 退款列表 | `start_time`, `end_time`, `page`, `page_size` |
| `xhs_query_items` | 查询商品列表 | `page`, `page_size`, `item_status` |
| `xhs_item_on_off_shelf` | 商品上架或下架 | `item_id`, `on_shelf` |
| `xhs_fetch_store_overview` | 拉取店铺经营概览（聚合订单、售后、商品数据） | `date`, `shop_id` |

### 聚合工具：xhs_fetch_store_overview

该工具一次性拉取多维度经营数据，适用于数字店长与一键日报场景：

- 同时调用订单列表、售后列表、商品列表三个 API
- 自动聚合为单一结构化响应
- 包含当日订单量、售后待处理数、在售商品数等关键指标

## 架构说明

### Webhook 入站流程

```
小红书开放平台事件推送
  --> POST /channels/xhs/webhook
    --> HMAC-SHA256 验签 (X-Xhs-Signature / X-Signature)
      --> 解析事件 body（event_type、shop_id/seller_id）
        --> publishInbound → Agent 管线处理
```

### 鉴权模式对比

| 特性 | 直连模式 | 多租户底座模式 |
|------|---------|---------------|
| 配置字段 | app_id + app_secret | app_id + ddd4j_api_base + ddd4j_api_key |
| 密钥持有 | 本插件持 app_secret | 底座持 app_secret，插件仅持 API Key |
| 调用方式 | 直接调用小红书 Open API | 经底座代理转发 |
| 适用场景 | 单租户 / 单店铺 | 多租户 SaaS / 安全合规需求 |

### API 调用签名（直连模式）

```text
1. 收集参数（含 app_id、timestamp）
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

# 高德地图 Amap

> **OpenClaw 插件 -- 高德开放平台渠道与运营工具，公域 Agent-First 智能运营**

[![npm](https://img.shields.io/npm/v/@partme.ai/openclaw-amap)](https://www.npmjs.com/package/@partme.ai/openclaw-amap)
[![Node](https://img.shields.io/badge/Node.js-22+-green)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E=2026.4.12-blueviolet)](https://github.com/partme-ai/openclaw)

[简体中文](./README.md)

## 简介

`@partme.ai/openclaw-amap` 是 OpenClaw 的渠道插件，集成高德开放平台 Web 服务 API，提供 POI 搜索、周边查询、地点详情等 LBS（基于位置的服务）运营工具。

插件将高德地图的 LBS 能力封装为 Agent 可调用的工具，支持地理位置相关的智能运营场景，如门店选址分析、周边竞品查询、POI 信息管理等。

### 核心能力

- **渠道通道** `amap` -- 渠道生命周期管理，配置 `channels.amap`
- **Webhook 入站** -- 注册 `POST /channels/amap/webhook` 路由（高德当前无统一事件推送，保留扩展）
- **Key 鉴权** -- 使用高德 Web 服务 API Key 进行鉴权，无需 OAuth
- **3 个 LBS 工具** -- POI 关键词搜索、周边搜索、地点详情查询
- **声明式配置向导** -- 通过 OpenClaw CLI 交互式配置 API Key

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-amap
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

## 配置

安装后在 `openclaw.json` 的 `channels.amap` 中配置 API Key。

### 基本配置

```jsonc
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

### 多账号配置

```jsonc
{
  "channels": {
    "amap": {
      "enabled": true,
      "key": "default_key",
      "accounts": {
        "account2": {
          "key": "account2_key",
          "poi_id": "account2_poi"
        }
      }
    }
  }
}
```

### 环境变量

| 变量名 | 说明 |
|--------|------|
| `AMAP_KEY` | 高德 Web 服务 API Key |
| `AMAP_API_BASE` | 高德 API 地址（默认 `https://restapi.amap.com`） |

## 配置参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `key` | `string` | -- | 高德开放平台 Web 服务 API Key |
| `secret` | `string` | -- | 安全密钥（保留字段，当前未使用） |
| `poi_id` | `string` | -- | 当前门店 / POI 标识 |
| `callback_url` | `string` | -- | 可选 Webhook 回调地址 |

## 工具列表

| 工具名称 | 说明 | 主要参数 |
|----------|------|---------|
| `amap_query_poi` | POI 关键字搜索：按关键字、区域、城市或 ID 查询地点 | `keywords`, `region`, `city`, `types`, `page`, `offset` |
| `amap_query_around` | 周边 POI 搜索：按经纬度与半径查询周边地点 | `location`, `keywords`, `radius`, `sortrule`, `page`, `offset` |
| `amap_place_detail` | POI 详情查询：根据 POI ID 获取完整地点信息 | `id` |

### 工具详解

#### amap_query_poi - POI 关键字搜索

支持按关键字模糊搜索、按城市限定搜索、按 POI 类型编码筛选。若传入 `id` 参数则自动切换到详情查询模式。

```json
{
  "keywords": "火锅",
  "city": "成都",
  "types": "050000",
  "page": 1,
  "offset": 20
}
```

#### amap_query_around - 周边搜索

以指定经纬度为中心，按半径搜索周边 POI。适用于门店选址、竞品分析等场景。

```json
{
  "location": "104.065077,30.572259",
  "radius": "1000",
  "keywords": "咖啡"
}
```

#### amap_place_detail - 地点详情

根据高德 POI ID 获取地点的详细结构化数据，包括名称、地址、电话、评分、营业时间等。

```json
{
  "id": "B0FFHX3Z4R"
}
```

## 架构说明

### API 调用流程

```
Agent 调用工具
  --> amapApiCall(key, path, params)
    --> 构造 URL: {AMAP_API_BASE}{path}?key={key}&{params}
    --> GET 请求高德 Web 服务 API
    --> 返回 JSON 解析结果
```

高德 Web 服务 API 使用 Key 作为 query 参数进行鉴权，无需 OAuth token 管理。

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

# 监听模式
pnpm dev
```

## 许可

MIT License

---

**PartMe.AI** -- 专注于 AI 智能客服与企业级 AI Agent 基础设施

[联系我们](mailto:partmeai@gmail.com) | [GitHub](https://github.com/partme-ai/openclaw-plugins)

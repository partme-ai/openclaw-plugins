<div align="center">

# OpenClaw Gotify

**OpenClaw 插件：Gotify 渠道桥接 -- REST API 推送 + WebSocket 流接收 + 多账号会话隔离**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--gotify-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[English](./README.en.md) | [简体中文](./README.zh-CN.md)

---

`@partme.ai/openclaw-gotify` 是为 [OpenClaw](https://github.com/openclaw/openclaw) 开发的 [Gotify](https://gotify.net/) 渠道插件，通过 REST API **发送消息**，通过 WebSocket `/stream` **实时接收消息**，完整支持 Application 和 Client 的**生命周期管理**。

## 特性

- **REST 消息发送** -- 通过 Gotify Message API（`POST /message`）发送 Agent 回复
- **WebSocket 流接收** -- 通过 Gotify Stream API（`GET /stream`）实时接收入站消息
- **Application 管理** -- 完整的 CRUD：创建、更新、删除、上传图标
- **Client 管理** -- 完整的 CRUD：创建、更新、删除
- **消息管理** -- 获取消息列表（游标分页）、按 ID 删除、批量删除
- **多账号多智能体** -- `accounts` 映射支持多个 Gotify 实例，按 `dmScope` 粒度隔离会话
- **会话隔离** -- 完全遵循 OpenClaw 全局 `session.dmScope` 配置
- **幂等去重** -- 60 秒窗口内相同账号+消息 ID 不会重复派发
- **消费即删策略** -- 默认严格模式，入站和出站回复在投递成功后自动删除

## 前置要求

- 已安装 [OpenClaw](https://github.com/openclaw/openclaw)（`>=2026.4.0`）
- **Node.js 22+**
- 一个运行中的 [Gotify 服务器](https://gotify.net/docs/install)（v2.x+）

## 快速开始

### 安装

```bash
# 使用 OpenClaw CLI（推荐）
openclaw plugins install @partme.ai/openclaw-gotify

# 或使用 npm
npm install @partme.ai/openclaw-gotify
```

### 最小配置（单账号）

```jsonc
{
  "channels": {
    "gotify": {
      "serverUrl": "https://gotify.example.com",
      "appToken": "Axxxxxxxxxxxxx",
      "clientToken": "Cxxxxxxxxxxxxx",
      "defaultPriority": 5,
      "inbound": {
        "enabled": true
      }
    }
  }
}
```

### 多账号多智能体

```jsonc
{
  "channels": {
    "gotify": {
      "defaultAccount": "ops",
      "accounts": {
        "ops": {
          "serverUrl": "https://ops-gotify.example.com",
          "appToken": "A_ops_token",
          "clientToken": "C_ops_client",
          "defaultPriority": 5,
          "inbound": { "enabled": true }
        },
        "alert": {
          "serverUrl": "https://alert-gotify.example.com",
          "appToken": "A_alert_token",
          "clientToken": "C_alert_client",
          "defaultPriority": 9,
          "inbound": { "enabled": true }
        }
      }
    }
  },
  "agents": {
    "ops-agent": {
      "channels": { "gotify": { "accounts": ["ops"] } }
    },
    "alert-agent": {
      "channels": { "gotify": { "accounts": ["alert"] } }
    }
  },
  "session": {
    "dmScope": "per-account-channel-peer"
  }
}
```

## 配置说明

### 顶级配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `true` | 是否启用渠道 |
| `serverUrl` | string | -- | Gotify 服务器地址 |
| `appToken` | string | -- | 应用 Token，用于发送消息（前缀 `A`） |
| `clientToken` | string | -- | 客户端 Token，用于接收消息和管理（前缀 `C`） |
| `defaultPriority` | number | `5` | 默认消息优先级（0-10） |
| `defaultAccount` | string | -- | 多账号模式下的默认账号 ID |
| `accounts` | object | -- | 多账号配置映射 |

### inbound -- WebSocket 流配置

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enabled` | boolean | `false`（有 `clientToken` 时为 `true`） | 是否启用 WebSocket 流监听 |
| `reconnectDelayMs` | number | `2000` | 初始重连延迟（毫秒） |
| `maxReconnectDelayMs` | number | `30000` | 最大重连延迟（指数退避上限） |
| `maxReconnectAttempts` | number | `10` | 最大重连尝试次数 |
| `deleteAfterConsume` | boolean | `true` | 消费即删 |

### 环境变量

| 变量 | 用途 |
|------|------|
| `GOTIFY_SERVER_URL` | Gotify 服务器地址 |
| `GOTIFY_APP_TOKEN` | 应用 Token |
| `GOTIFY_CLIENT_TOKEN` | 客户端 Token |

## 消息处理流程

```
Gotify Server                      openclaw-gotify Plugin                OpenClaw Gateway
    │                                       │                                  │
    │  POST /message (入站)                   │                                  │
    ├──────────────────────────────────────► │                                  │
    │                                       │ WebSocket → dedup → session       │
    │  WS /stream                            │    → Agent                       │
    │◄──────────────────────────────────────┤                                  │
    │                                       │                                  │
    │                                       │  POST /message (出站回复)          │
    │◄──────────────────────────────────────┤                                  │
    │                                       │                                  │
```

1. Gotify 应用或外部系统发送消息到 Gotify 服务器
2. 插件通过 WebSocket `/stream` 实时接收消息
3. 幂等去重（60 秒窗口）
4. 解析对端标识（`extras.openclaw.peerId` → `appid` → `title`）
5. 按 `session.dmScope` 构造会话键
6. 路由到对应 Agent 处理
7. Agent 回复通过 `POST /message` 发送回 Gotify

## dmScope 会话隔离

| dmScope | 会话键格式 | 隔离粒度 |
|---------|-----------|----------|
| `main` | `agent:<agentId>:main` | 所有消息共享同一会话 |
| `per-peer` | `agent:<agentId>:direct:<peerId>` | 按对端隔离 |
| `per-channel-peer` | `agent:<agentId>:gotify:direct:<peerId>` | 按渠道+对端隔离 |
| `per-account-channel-peer` | `agent:<agentId>:gotify:<accountId>:direct:<peerId>` | 按账号+渠道+对端隔离（推荐多账号） |

对端标识解析优先级：`extras.openclaw.peerId` → `appid` → `title` → `"gotify"`

## 测试

```bash
# 单元测试
pnpm test

# 类型检查
pnpm typecheck

# 构建
pnpm build

# 标准测试（需真实 Gotify 服务器）
pnpm test:standard

# UI 验收门禁（发布必过）
pnpm test:ui-gate
```

## 项目结构

```
openclaw-gotify/
├── src/
│   ├── index.ts                  # 入口
│   ├── setup-entry.ts            # 设置入口
│   ├── channel.ts                # ChannelPlugin 定义
│   ├── gotify-api.ts             # Gotify REST API 封装
│   ├── config.ts                 # 配置解析
│   ├── channel-config.ts         # ChannelConfigSchema
│   ├── peer-resolver.ts          # 对端标识解析
│   ├── inbound-access.ts         # 入站 DM 策略
│   ├── message-mapper.ts         # 消息映射
│   ├── outbound.ts               # ChannelOutboundAdapter
│   ├── ws-listener.ts            # WebSocket 监听器
│   ├── setup.ts                  # 引导与诊断
│   ├── runtime.ts                # 运行时状态管理
│   ├── config-wizard.ts          # 配置向导
│   ├── gotify-client.ts          # GotifyClient 封装
│   └── types.ts                  # 类型定义
├── scripts/
│   ├── e2e-agent-test.ts         # E2E Agent 测试
│   └── ui-transcript-gate-test.ts # UI 验收门禁
├── openclaw.plugin.json
├── package.json
└── README.md / README.en.md
```

## 常见问题

**必须同时配置 appToken 和 clientToken 吗？**

如果只需要发送消息（出站），仅配置 `appToken` 即可；如果需要实时接收消息（入站），则需要 `clientToken`。

**WebSocket 连接断开后会自动重连吗？**

是的，使用指数退避重连策略：初始延迟 2000ms，每次失败翻倍，上限 30000ms，最多重试 10 次。

**如何实现多智能体隔离？**

通过 `session.dmScope` 配置会话隔离粒度。推荐多账号场景使用 `"per-account-channel-peer"`。

## 相关链接

- [OpenClaw 官方文档](https://docs.openclaw.ai)
- [Gotify 官网](https://gotify.net/)
- [Gotify 文档](https://gotify.net/docs/)
- [Push Message API](https://gotify.net/docs/pushmsg)

## 许可证

本项目采用 [MIT License](./LICENSE) 协议。

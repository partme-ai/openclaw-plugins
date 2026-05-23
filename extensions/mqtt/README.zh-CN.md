<div align="center">

# OpenClaw MQTT

**OpenClaw 插件：支持多 Topic 与显式绑定规则的 MQTT 渠道桥接**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--mqtt-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![MQTT](https://img.shields.io/badge/MQTT-3.1.1%2F5.0-orange)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

## 简介

`@partme.ai/openclaw-mqtt` 是为 [OpenClaw](https://github.com/openclaw/openclaw) 提供的 MQTT 渠道插件，内置 [Aedes](https://github.com/moscajs/aedes) broker，将设备消息桥接到 Agent。插件按照官方文档使用 [`defineChannelPluginEntry`](https://docs.openclaw.ai/plugins/sdk-entrypoints#definechannelpluginentry) + `ChannelPlugin` 实现（渠道插件请勿使用仅适用于非渠道插件的 `definePluginEntry`）。

### 核心能力

- **内嵌 Broker**：无需额外部署 MQTT broker，开箱即用
- **显式绑定优先**：`topicBindings` 命中有最高路由优先级
- **标准 Topic 回退**：未命中绑定时自动回退到 `openclaw/agent/<agentId>/in`
- **回复 Topic 可控**：支持绑定级 `replyTopic`，否则自动推导 `/out`
- **会话上下文映射**：按 session 保存 agent/account/replyTopic 信息
- **企业级安全**：MQTT over TLS、用户级 topic ACL、匿名访问控制、消息大小限制

### 生命周期

- 内嵌 Broker 在 Gateway 对 MQTT 渠道执行 `startAccount` 时启动（当前版本为单账号 `default`）
- HTTP `GET /mqtt/status` 在入口的 `registerFull` 中注册，可查看 broker 统计、配置快照及策略热更新元数据
- 会话键粒度遵循 OpenClaw 全局 `session.dmScope` 配置
- **`package.json` → `openclaw.setupEntry`** 指向 `dist/setup-entry.js`，通过 `defineSetupPluginEntry` 导出轻量入口

### 主要特性

#### 1. 内嵌 Broker

Aedes MQTT broker 随进程启动，支持 MQTT 3.1.1 和 MQTT 5.0 协议版本，无需外部依赖。

#### 2. Topic 路由

- **显式绑定**：`topicBindings` 数组中配置 `topicPattern` → `agentId` + 可选 `replyTopic`
- **标准回退**：`openclaw/agent/<agentId>/in` ↔ `openclaw/agent/<agentId>/out`
- **通配符支持**：`+`（单段匹配）和 `#`（多段匹配）

#### 3. 企业级控制

| 领域 | 功能 |
|------|------|
| 认证 | 用户名/密码、每用户 ACL、匿名访问开关 |
| 传输 | TCP（1883）+ TLS（8883），可配置 cert/key/CA |
| QoS | 0（至多一次）+ mailbox 软限制，1（至少一次）+ ACK 重试 |
| 持久化 | 多后端：memory、redis（含 mqemitter）、mongodb、level、nedb |
| 限制 | 可配置最大 payload 字节数、最大连接数 |
| 会话 | 基于过期时间的清理，支持跨重连保留 |
| 可观测性 | Prometheus 指标（`prom-client`）、结构化 JSON 审计日志 |
| Will / Retain | 可配置 retain 策略、will 消息白名单 |

### 水平扩展

默认单进程内存运行，启用持久化即可实现多 Gateway 水平扩展：

```json
{
  "channels": {
    "mqtt": {
      "persistence": {
        "enabled": true,
        "backend": "redis",
        "redis": {
          "host": "redis.example.com",
          "port": 6379
        }
      }
    }
  }
}
```

支持多种持久化后端：memory、redis、mongodb、level、nedb。

## 消息处理流程

1. 设备发送 MQTT 消息
2. 插件按 `subscribeTopics` 白名单过滤
3. 路由决策（`topicBindings` 优先 → 标准 Topic 回退）
4. Payload 解析（`JSON.text` → 纯文本回退）
5. 调用 OpenClaw runtime 分发到 Agent
6. 回复消息发布到 `replyTopic` 或默认 `/out`

## 快速开始

### 前置条件

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-mqtt
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

### 最小配置

```json
{
  "channels": {
    "mqtt": {
      "port": 1883,
      "maxConnections": 1000,
      "subscribeTopics": [
        "devices/+/in",
        "openclaw/agent/+/in"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices/+/in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "devices/reply"
        }
      ],
      "payload": {
        "mode": "jsonTextOrPlain"
      }
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## Topic 规则

| 类型 | 格式 |
|------|------|
| 标准入站 | `openclaw/agent/<agentId>/in` |
| 标准出站 | `openclaw/agent/<agentId>/out` |
| 显式路由 | 由 `topicBindings.topicPattern` 定义 |

路由优先级：`topicBindings` → 标准入站解析 → 丢弃

## 配置说明

### 必填

| 字段 | 说明 |
|------|------|
| `port` | MQTT TCP 监听端口（默认：`1883`） |

### Channel

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `port` | `1883` | MQTT TCP 监听端口 |
| `maxConnections` | `1000` | 最大并发连接数 |
| `subscribeTopics` | `[]` | 允许接收的入站 topic 模式 |
| `topicBindings` | `[]` | 显式 topic → agent 绑定规则 |

### Auth

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `auth.enabled` | `false` | 启用客户端认证 |
| `auth.allowAnonymous` | `false` | 允许匿名连接 |
| `auth.users` | `[]` | 用户列表，支持每用户 publish/subscribe ACL |

### TLS

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `tls.enabled` | `false` | 启用 TLS 监听（端口 8883） |
| `tls.certFile` | — | TLS 证书路径（PEM） |
| `tls.keyFile` | — | TLS 私钥路径（PEM） |
| `tls.caFile` | — | 可选 CA 证书路径 |
| `tls.requestCert` | `false` | 请求客户端证书 |
| `tls.rejectUnauthorized` | `false` | 拒绝未授权证书 |

### 限制与会话

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `limits.maxPayloadBytes` | `1048576` | 单条消息最大字节数 |
| `session.maxExpirySeconds` | `86400` | 断线后会话过期时间 |
| `session.persistentAcrossReconnect` | `true` | 允许会话跨重连保留 |

### 持久化

| 字段 | 默认值 | 说明 |
|------|--------|------|
| `persistence.enabled` | `false` | 启用持久化，实现水平扩展 |
| `persistence.backend` | `"memory"` | 后端类型：`memory`、`redis`、`mongodb`、`level`、`nedb` |

## 测试

```bash
# 单元测试
npm test

# 集成测试
npm run test:client
```

集成测试客户端环境变量：`MQTT_BROKER_URL`、`MQTT_CLIENT_ID`、`MQTT_TEST_TIMEOUT_MS` 等。

## GitHub Actions

| 工作流 | 触发方式 | 作用 |
|--------|----------|------|
| `ci.yml` | push / PR 到 `main` | 安装、类型检查、构建、测试 |
| `release.yml` | `v*` 标签 | 构建、测试并发布 npm 包 |

## 发版

```bash
npm version patch
git push origin main --follow-tags
```

## 项目结构

```
openclaw-mqtt/
├── src/
│   ├── index.ts              # defineChannelPluginEntry + registerFull
│   ├── setup-entry.ts        # defineSetupPluginEntry 轻量入口
│   ├── mqtt-plugin.ts        # ChannelPlugin 定义
│   ├── gateway-mqtt.ts       # Gateway 生命周期管理
│   ├── outbound.ts           # ChannelOutboundAdapter
│   ├── inbound.ts            # 入站消息处理
│   ├── broker.ts             # Aedes TCP 服务器
│   ├── topic-router.ts       # Topic 路由解析
│   ├── session-mapper.ts     # 会话上下文映射
│   ├── mqtt-config.ts        # 配置解析
│   └── runtime.ts            # 运行时
├── scripts/
│   └── test-client.ts       # 集成测试客户端
├── openclaw.plugin.json     # 插件元数据
├── package.json
└── README.md / README.zh-CN.md
```

## 技术栈

| 类别 | 详情 |
|------|------|
| 运行时 | Node.js 20+、ESM |
| Broker | [Aedes](https://github.com/moscajs/aedes) |
| 持久化 | aedes-persistence-redis、aedes-persistence-mongodb、aedes-persistence-level、aedes-persistence-nedb |
| 指标 | [prom-client](https://github.com/siimon/prom-client) |
| 宿主 | OpenClaw 插件 API（`defineChannelPluginEntry`、`registerService`） |

## 版本信息

| 项目 | 版本 |
|------|------|
| @partme.ai/openclaw-mqtt | 0.1.13 |
| 推荐 Node | 20+ |

## 安全

- **不要在配置中存储凭据**：使用环境变量或密钥管理器存放密码和 API 密钥
- **TLS 校验**：生产环境建议启用 `tls.rejectUnauthorized` 防止中间人攻击
- **ACL 范围控制**：使用 `auth.users[].publishAllow` / `subscribeAllow` 限制设备 topic
- **审计日志**：启用 `audit.enabled` 输出结构化 JSON 日志，兼容 ELK/SIEM

## 常见问题

**是否必须依赖外部 MQTT broker？**

不需要，插件内嵌 `aedes` broker。

**Payload 如何解析？**

默认 `jsonTextOrPlain` 模式：优先解析 `JSON.text` 字段，未命中则回退原始文本。

**如何绑定 Topic 到 Agent？**

通过 `topicBindings` 配置 `topicPattern` 与 `agentId`，可选配置 `replyTopic`。

## 相关链接

| 资源 | 链接 |
|------|------|
| OpenClaw | [https://docs.openclaw.ai](https://docs.openclaw.ai) |
| OpenClaw 源码 | [https://github.com/openclaw/openclaw](https://github.com/openclaw/openclaw) |
| Aedes MQTT Broker | [https://github.com/moscajs/aedes](https://github.com/moscajs/aedes) |
| RabbitMQ MQTT 参考 | [https://www.rabbitmq.com/docs/mqtt](https://www.rabbitmq.com/docs/mqtt) |
| English | [README.md](./README.md) |

### OpenClaw 官方文档

| 说明 | 链接 |
|------|------|
| Channel plugins | [https://docs.openclaw.ai/plugins/sdk-channel-plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins) |
| SDK entry points | [https://docs.openclaw.ai/plugins/sdk-entrypoints](https://docs.openclaw.ai/plugins/sdk-entrypoints) |
| SDK runtime | [https://docs.openclaw.ai/plugins/sdk-runtime](https://docs.openclaw.ai/plugins/sdk-runtime) |
| SDK setup | [https://docs.openclaw.ai/plugins/sdk-setup](https://docs.openclaw.ai/plugins/sdk-setup) |

## 开源协议

本项目采用 [MIT License](LICENSE) 协议。

## 致谢

- [Aedes](https://github.com/moscajs/aedes) — 内嵌 MQTT broker
- [RabbitMQ](https://www.rabbitmq.com/) — 企业级 MQTT 功能参考
- [OpenClaw](https://docs.openclaw.ai) — 插件宿主运行时

---

<div align="center">

**如果这个项目对你有帮助，请给我们一个星星**

Made with love by PartMe

</div>

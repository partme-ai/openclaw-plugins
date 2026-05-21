<div align="center">

# OpenClaw MQTT

**OpenClaw 插件：支持多 Topic 与显式绑定规则的 MQTT 渠道桥接**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--mqtt-blue)
![Node](https://img.shields.io/badge/Node.js-20+-green)
![License](https://img.shields.io/badge/License-MIT-green)
![MQTT](https://img.shields.io/badge/MQTT-3.1.1%2F5.0-orange)

</div>

[English](./README.md) | [简体中文](./README.zh-CN.md)

---

`@partme.ai/openclaw-mqtt` 是为 [OpenClaw](https://github.com/openclaw/openclaw) 提供的 MQTT 渠道插件，内置 [Aedes](https://github.com/moscajs/aedes) broker，将设备消息桥接到 AI Agent，开箱即用。

## 特性

- **内嵌 Broker** -- 无需额外部署 MQTT broker，开箱即用
- **显式绑定优先** -- `topicBindings` 命中有最高路由优先级
- **标准 Topic 回退** -- 未命中绑定时自动回退到 `openclaw/agent/<agentId>/in`
- **回复 Topic 可控** -- 支持绑定级 `replyTopic`，否则自动推导 `/out`
- **会话上下文映射** -- 按 session 保存 agent/account/replyTopic 信息
- **企业级安全** -- MQTT over TLS、用户级 topic ACL、匿名访问控制、消息大小限制
- **可观测性** -- Prometheus 指标、结构化 JSON 审计日志
- **水平扩展** -- 支持 Redis、MongoDB 等多后端持久化

## 前置要求

- OpenClaw `>= 2026.4.0`
- Node.js `20+`

## 快速开始

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-mqtt
```

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
| `tls.certFile` | -- | TLS 证书路径（PEM） |
| `tls.keyFile` | -- | TLS 私钥路径（PEM） |
| `tls.caFile` | -- | 可选 CA 证书路径 |
| `tls.requestCert` | `false` | 请求客户端证书 |
| `tls.rejectUnauthorized` | `false` | 拒绝未授权证书 |

### Topic 规则

| 类型 | 格式 |
|------|------|
| 标准入站 | `openclaw/agent/<agentId>/in` |
| 标准出站 | `openclaw/agent/<agentId>/out` |
| 显式路由 | 由 `topicBindings.topicPattern` 定义 |

路由优先级：`topicBindings` → 标准入站解析 → 丢弃

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

## 消息处理流程

1. 设备发送 MQTT 消息
2. 插件按 `subscribeTopics` 白名单过滤
3. 路由决策（`topicBindings` 优先 → 标准 Topic 回退）
4. Payload 解析（`JSON.text` → 纯文本回退）
5. 调用 OpenClaw runtime 分发到 Agent
6. 回复消息发布到 `replyTopic` 或默认 `/out`

## 水平扩展

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

## 项目结构

```
openclaw-mqtt/
├── src/
│   ├── index.ts                  # 入口
│   ├── setup-entry.ts            # 设置入口
│   ├── mqtt-plugin.ts            # ChannelPlugin 定义
│   ├── gateway-mqtt.ts           # Gateway 生命周期管理
│   ├── outbound.ts               # ChannelOutboundAdapter
│   ├── inbound.ts                # 入站消息处理
│   ├── broker.ts                 # Aedes TCP 服务器
│   ├── topic-router.ts           # Topic 路由解析
│   ├── session-mapper.ts         # 会话上下文映射
│   ├── mqtt-config.ts            # 配置解析
│   └── runtime.ts                # 运行时
├── scripts/
│   └── test-client.ts            # 集成测试客户端
├── openclaw.plugin.json
├── package.json
└── README.md / README.zh-CN.md
```

## 测试

```bash
# 单元测试
npm test

# 集成测试
npm run test:client
```

## 安全建议

- **不要在配置中存储凭据**：使用环境变量或密钥管理器存放密码和 API 密钥
- **TLS 校验**：生产环境建议启用 `tls.rejectUnauthorized` 防止中间人攻击
- **ACL 范围控制**：使用 `auth.users[].publishAllow` / `subscribeAllow` 限制设备 topic

## 技术栈

| 类别 | 详情 |
|------|------|
| 运行时 | Node.js 20+、ESM |
| Broker | [Aedes](https://github.com/moscajs/aedes) |
| 持久化 | aedes-persistence-redis、aedes-persistence-mongodb 等 |
| 指标 | [prom-client](https://github.com/siimon/prom-client) |

## 常见问题

**是否必须依赖外部 MQTT broker？**

不需要，插件内嵌 `aedes` broker。

**Payload 如何解析？**

默认 `jsonTextOrPlain` 模式：优先解析 `JSON.text` 字段，未命中则回退原始文本。

**如何绑定 Topic 到 Agent？**

通过 `topicBindings` 配置 `topicPattern` 与 `agentId`，可选配置 `replyTopic`。

## 相关链接

- [OpenClaw 文档](https://docs.openclaw.ai)
- [Aedes MQTT Broker](https://github.com/moscajs/aedes)
- [RabbitMQ MQTT 参考](https://www.rabbitmq.com/docs/mqtt)

## 许可证

本项目采用 [MIT License](LICENSE) 协议。

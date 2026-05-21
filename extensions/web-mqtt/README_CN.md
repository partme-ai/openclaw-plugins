# OpenClaw Web MQTT

**OpenClaw 渠道插件 -- 企业级 MQTT over WebSocket，支持 topic 治理与 agent 绑定**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--web--mqtt-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

[English](./README.md) | [简体中文](./README_CN.md)

---

## 功能特性

- **多 topic 订阅治理**：`subscribeTopics` 白名单，支持 MQTT 通配符 `+` / `#`
- **topic-agent 显式绑定**：`topicPattern -> agentId` 直接路由，可选绑定 `replyTopic`
- **标准路由回退**：`<topicPrefix>agent/<agentId>/in` -> `<topicPrefix>agent/<agentId>/out`
- **企业级增强**：
  - 鉴权与用户级 topic 访问控制
  - TLS / WSS 支持
  - 消息大小与 WebSocket 帧大小限制
  - 空闲超时与连接治理
  - 路由命中与丢弃原因统计

## 消息处理流程

1. Web MQTT 客户端发布消息到 topic
2. 插件按 `subscribeTopics` 过滤入站消息
3. 路由决策：优先匹配 `topicBindings`，未命中则回退标准 topic 推导
4. payload 按 `jsonTextOrPlain` 模式解析
5. 进入 OpenClaw reply pipeline
6. Agent 回复发布到绑定的 `replyTopic` 或默认 out topic

## 快速开始

### 前置条件

- OpenClaw `>= 2026.4.0`
- Node.js `22+`

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-web-mqtt
```

### 最小配置（`openclaw.json`）

```json
{
  "channels": {
    "mqtt-ws": {
      "port": 15675,
      "path": "/ws",
      "topicPrefix": "openclaw/",
      "subscribeTopics": ["openclaw/agent/+/in", "devices/+/in"],
      "topicBindings": [
        {
          "topicPattern": "devices/+/in",
          "agentId": "iot-agent",
          "replyTopic": "devices/reply"
        }
      ],
      "payload": { "mode": "jsonTextOrPlain" },
      "auth": {
        "required": true,
        "allowAnonymous": false,
        "users": [
          {
            "username": "mqtt_user",
            "password": "change_me",
            "publishAllow": ["openclaw/agent/+/in", "devices/+/in"],
            "subscribeAllow": ["openclaw/agent/+/out", "devices/reply"]
          }
        ]
      },
      "tls": { "enabled": false },
      "ws": {
        "compress": true,
        "idleTimeoutMs": 60000,
        "maxFrameSize": 262144
      },
      "limits": {
        "maxPayloadBytes": 1048576,
        "maxSubscriptionsPerClient": 200
      }
    }
  }
}
```

## 配置参考

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `port` | number | `15675` | WebSocket 监听端口 |
| `path` | string | `/ws` | WebSocket 路径 |
| `topicPrefix` | string | `openclaw/` | topic 前缀，用于路由推导 |
| `subscribeTopics` | string[] | `[]` | 入站 topic 白名单 |
| `topicBindings` | object[] | `[]` | topic 到 agent 显式绑定 |
| `payload.mode` | enum | `jsonTextOrPlain` | payload 解析模式 |
| `auth.required` | boolean | `true` | 是否要求认证 |
| `auth.allowAnonymous` | boolean | `false` | 是否允许匿名连接 |
| `auth.users` | object[] | `[]` | MQTT 用户配置 |
| `tls.enabled` | boolean | `false` | 是否开启 WSS |
| `tls.certFile` / `tls.keyFile` / `tls.caFile` | string | - | TLS 证书文件 |
| `ws.compress` | boolean | `true` | 是否启用 WebSocket 压缩 |
| `ws.idleTimeoutMs` | number | `60000` | 空闲超时（ms） |
| `ws.maxFrameSize` | number | `262144` | WebSocket 帧最大字节数 |
| `limits.maxPayloadBytes` | number | `1048576` | 消息 payload 最大字节数 |
| `limits.maxSubscriptionsPerClient` | number | `200` | 每客户端最大订阅数 |

## 企业级加固建议

- 强制替换默认账号，使用独立 MQTT 用户
- 生产环境开启 `tls.enabled`，部署 WSS
- 严格配置 `publishAllow` / `subscribeAllow` 进行 topic 级访问控制
- 按流量调优 `maxPayloadBytes`、`maxFrameSize`、`idleTimeoutMs`
- 配合反向代理与网络 ACL 做边界隔离

## 状态与可观测性

`GET /mqtt-ws/status`（插件鉴权路由）输出：

- 当前连接数
- 入站接受 / 丢弃计数
- binding 与标准回退路由命中计数
- 出站发布计数
- 最近错误摘要
- 脱敏后的生效配置快照

## 测试

### 单元测试

```bash
npm test
```

### 集成测试客户端

```bash
npm run test:client
```

默认测试端点：`MQTT_BROKER_URL=ws://127.0.0.1:15675/ws`

支持环境变量：

- `MQTT_BROKER_URL`
- `MQTT_CLIENT_ID`
- `MQTT_TEST_TIMEOUT_MS`
- `MQTT_TEST_SUBSCRIBE_TOPICS`
- `MQTT_TEST_PUBLISH_CASES`
- `MQTT_TEST_TOPIC_JSON`
- `MQTT_TEST_TOPIC_PLAIN`
- `MQTT_TEST_REPLY_TOPIC`

## CI 与发版

| 工作流 | 触发方式 | 作用 |
|--------|----------|------|
| `.github/workflows/ci.yml` | Push / PR | 安装、类型检查、构建、测试、上传产物 |
| `.github/workflows/release.yml` | `v*` tag / 手动触发 | 构建、测试并发布 npm（已存在版本自动跳过） |

发版细节见 [RELEASING.md](./RELEASING.md)。

## RabbitMQ Web-MQTT 兼容基线

本插件参考 RabbitMQ Web-MQTT 官方生产实践：

- 默认 websocket 端点约定 `15675/ws`
- 明确插件启用与独立用户策略
- WSS/TLS 生产部署建议
- websocket 帧大小 / 超时 / 压缩调优建议

参考文档：[RabbitMQ Web MQTT](https://www.rabbitmq.com/docs/web-mqtt)

## 相关文档

### OpenClaw 插件系统

- [Tools - Plugins](https://docs.openclaw.ai/tools/plugin)
- [Community plugins](https://docs.openclaw.ai/plugins/community)
- [SDK - Channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- [SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [SDK entry points](https://docs.openclaw.ai/plugins/sdk-entrypoints)
- [SDK runtime](https://docs.openclaw.ai/plugins/sdk-runtime)
- [SDK setup](https://docs.openclaw.ai/plugins/sdk-setup)
- [SDK testing](https://docs.openclaw.ai/plugins/sdk-testing)
- [Manifest](https://docs.openclaw.ai/plugins/manifest)
- [Architecture](https://docs.openclaw.ai/plugins/architecture)

## 许可证

MIT

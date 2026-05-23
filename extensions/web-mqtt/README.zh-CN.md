<div align="center">

# OpenClaw Web MQTT

**OpenClaw 渠道插件：企业级 MQTT over WebSocket，支持 topic 治理与 agent 绑定**

![npm](https://img.shields.io/badge/npm-@partme.ai%2Fopenclaw--web--mqtt-blue)
![Node](https://img.shields.io/badge/Node.js-22+-green)
![License](https://img.shields.io/badge/License-MIT-green)

</div>

[简体中文](./README.zh-CN.md) | [English](./README.md)

## 简介

`@partme.ai/openclaw-web-mqtt` 是基于 OpenClaw 最新 channel SDK 的渠道插件：

- 使用 `defineChannelPluginEntry` 进行完整注册
- 使用 `defineSetupPluginEntry` 支持 setup-only 轻量加载
- 使用 runtime store 管理 runtime 注入与读取

插件提供内嵌强化版 MQTT over WebSocket broker，面向浏览器与 Web 应用接入，并将入站消息路由给 OpenClaw Agent。

## 核心能力

- **多 topic 订阅治理**：`subscribeTopics` 白名单，支持 `+/#` 通配符
- **topic-agent 显式绑定**：`topicPattern -> agentId`，支持绑定 `replyTopic`
- **标准路由回退**：`<topicPrefix>agent/<agentId>/in` -> `<topicPrefix>agent/<agentId>/out`
- **企业级增强**：
  - 鉴权与用户级 topic 访问控制
  - TLS/WSS 支持
  - 消息大小与 WebSocket 帧大小限制
  - 空闲超时与连接治理
  - 路由命中与丢弃原因统计

## 消息处理流程

1. Web MQTT 客户端发布消息
2. 插件按 `subscribeTopics` 过滤
3. 路由决策：
   - 优先 `topicBindings`
   - 回退标准 topic
4. payload 按 `jsonTextOrPlain` 解析
5. 进入 OpenClaw reply pipeline
6. 回复发布到绑定 `replyTopic` 或默认 out topic

## 快速开始

### 前置条件

- OpenClaw `>= 2026.4.0`
- Node.js `22+`

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-web-mqtt
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

### 最小配置（`openclaw.json`）

```json
{
  "channels": {
    "mqtt-ws": {
      "port": 15675,
      "path": "/ws",
      "topicPrefix": "openclaw/",
      "subscribeTopics": [
        "openclaw/agent/+/in",
        "devices/+/in"
      ],
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
      "tls": {
        "enabled": false
      },
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

## 企业级加固建议

- 强制替换默认账号，使用独立 MQTT 用户
- 生产环境开启 `tls.enabled`，部署 WSS
- 严格配置 `publishAllow` / `subscribeAllow`
- 按流量调优 `maxPayloadBytes`、`maxFrameSize`、`idleTimeoutMs`
- 配合反向代理与网络 ACL 做边界隔离

## 状态与可观测性

`GET /mqtt-ws/status`（插件鉴权路由）输出：

- 当前连接数
- 入站接受/丢弃计数
- binding 与标准回退路由命中计数
- 出站发布计数
- 最近错误摘要
- 脱敏后的生效配置快照

## 测试

### 单元测试

```bash
npm test
```

### 集成测试端

```bash
npm run test:client
```

默认测试端点：

- `MQTT_BROKER_URL=ws://127.0.0.1:15675/ws`

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
| --- | --- | --- |
| `.github/workflows/ci.yml` | Push / PR | 安装、类型检查、构建、测试、上传产物 |
| `.github/workflows/release.yml` | `v*` tag / 手动触发 | 构建、测试并发布 npm（已存在版本自动跳过） |

发版细节见 [`RELEASING.md`](./RELEASING.md)。

## RabbitMQ Web-MQTT 兼容基线

本插件参考 RabbitMQ Web-MQTT 官方生产实践：

- 默认 websocket 端点约定 `15675/ws`
- 明确插件启用与独立用户策略
- WSS/TLS 生产部署建议
- websocket 帧大小/超时/压缩调优建议

参考文档：[RabbitMQ Web MQTT](https://www.rabbitmq.com/docs/web-mqtt)

## OpenClaw 官方文档

### Plugins

- [Tools - Plugins](https://docs.openclaw.ai/tools/plugin)
- [Community plugins](https://docs.openclaw.ai/plugins/community)
- [Bundles](https://docs.openclaw.ai/plugins/bundles)
- [Voice call](https://docs.openclaw.ai/plugins/voice-call)

### Building plugins

- [Building plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [SDK - Channel plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- [SDK - Provider plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins)
- [SDK - Migration](https://docs.openclaw.ai/plugins/sdk-migration)

### SDK reference

- [SDK overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [SDK entry points](https://docs.openclaw.ai/plugins/sdk-entrypoints)
- [SDK runtime](https://docs.openclaw.ai/plugins/sdk-runtime)
- [SDK setup](https://docs.openclaw.ai/plugins/sdk-setup)
- [SDK testing](https://docs.openclaw.ai/plugins/sdk-testing)
- [Manifest](https://docs.openclaw.ai/plugins/manifest)
- [Architecture](https://docs.openclaw.ai/plugins/architecture)

## 许可证

MIT

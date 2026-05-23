

# OpenClaw STOMP

**OpenClaw 渠道插件：原生 STOMP TCP 桥接，支持企业级投递控制**

npm
Node
License



[简体中文](./README.zh-CN.md) | [English](./README.md)

## 简介

`@partme.ai/openclaw-stomp` 是 OpenClaw 的 STOMP 渠道插件，内置原生 STOMP TCP 服务（`stomp-tcp`），将 STOMP 客户端消息桥接到 OpenClaw Agent。

本次版本已按 OpenClaw 最新插件规范改造：

- 使用 `defineChannelPluginEntry` 作为完整入口
- 使用 `defineSetupPluginEntry` 作为 setup-only 轻量入口
- `package.json` 配置 `openclaw.setupEntry`

## 核心能力

- STOMP `CONNECT` / `SEND` / `SUBSCRIBE` / `UNSUBSCRIBE` / `ACK` / `NACK` / `DISCONNECT`
- STOMP 1.0/1.1/1.2 版本握手
- ACK 模式：`auto`、`client`、`client-individual`
- `prefetch-count` 流控
- durable 订阅（`durable:true + auto-delete:false`）
- 多 topic 白名单（`subscribeTopics`）
- topic 与 agent 显式绑定（`topicBindings`）
- TLS 监听支持
- 状态接口：`GET /stomp-tcp/status`

## 消息流程

1. STOMP 客户端建立连接并订阅多个 topic。
2. 客户端发送 `SEND`。
3. 插件路由决策：
  - 先命中 `topicBindings`
  - 未命中则走 destination 默认推导
4. 插件调用 OpenClaw runtime 分发到 Agent。
5. Agent 回复发布到绑定 `replyDestination` 或会话默认 topic。
6. `client/client-individual` 模式下，受 prefetch 限制并等待 `ACK`。

## 会话隔离（遵循 OpenClaw `session.dmScope`）

插件不再额外定义自有“会话隔离粒度”配置，直接遵循 OpenClaw 全局会话策略：

- `session.dmScope: "main"`
- `session.dmScope: "per-peer"`
- `session.dmScope: "per-channel-peer"`
- `session.dmScope: "per-account-channel-peer"`

会话键隔离仅由 `session.dmScope` 决定。

## 快速开始

### 前置条件

- OpenClaw `>= 2026.4.x`
- Node.js `22+`

### 安装

```bash
openclaw plugins install @partme.ai/openclaw-stomp
```

最低依赖：`@partme.ai/openclaw-message-sdk >= 2026.5.22`。

### 最小配置（`openclaw.json`）

```json
{
  "channels": {
    "stomp-tcp": {
      "port": 61613,
      "tlsPort": 61614,
      "tls": {
        "enabled": false
      },
      "maxConnections": 1000,
      "maxFrameSize": 4194304,
      "defaultAckMode": "auto",
      "prefetchCount": 100,
      "subscribeTopics": [
        "devices/*/in",
        "openclaw/agent/*/in"
      ],
      "topicBindings": [
        {
          "topicPattern": "devices/*/in",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "/topic/devices/reply"
        }
      ],
      "auth": {
        "required": false
      }
    }
  }
}
```

## 配置说明


| 配置项                                           | 类型       | 默认值       | 说明                       |
| --------------------------------------------- | -------- | --------- | ------------------------ |
| `port`                                        | number   | `61613`   | STOMP TCP 监听端口           |
| `tlsPort`                                     | number   | `61614`   | STOMP TLS 监听端口（`0` 表示关闭） |
| `tls.enabled`                                 | boolean  | `false`   | 是否开启 TLS                 |
| `tls.certFile` / `tls.keyFile` / `tls.caFile` | string   | -         | TLS 证书文件                 |
| `heartbeat.serverMs` / `heartbeat.clientMs`   | number   | `10000`   | 心跳参数                     |
| `maxConnections`                              | number   | `1000`    | 最大连接数                    |
| `maxFrameSize`                                | number   | `4194304` | 单帧最大字节数                  |
| `auth.required`                               | boolean  | `true`    | 是否要求 CONNECT 认证          |
| `auth.defaultUser` / `auth.defaultPass`       | string   | -         | 默认账号密码                   |
| `subscribeTopics`                             | string[] | `[]`      | 入站 destination 白名单       |
| `topicBindings`                               | object[] | `[]`      | topic 到 agent 显式绑定       |
| `defaultAckMode`                              | enum     | `auto`    | 默认 ACK 模式                |
| `prefetchCount`                               | number   | `100`     | 默认 prefetch              |


## 测试

### 单元测试

```bash
npm test
```

### STOMP 测试端

```bash
npm run test:client
```

可用环境变量：

- `STOMP_HOST`、`STOMP_PORT`、`STOMP_TIMEOUT_MS`
- `STOMP_TEST_SUBSCRIBE_TOPICS`
- `STOMP_TEST_PUBLISH_CASES`（JSON 数组）
- `STOMP_TEST_DEST_1`、`STOMP_TEST_DEST_2`
- `STOMP_TEST_BODY_1`、`STOMP_TEST_BODY_2`

## 状态接口

`GET /stomp-tcp/status` 返回：

- 连接列表
- 协议版本分布
- 统计快照：入站/出站路由量、丢弃量、待 ACK 数

## CI 与发版


| 工作流                             | 触发方式                        | 作用                                 |
| ------------------------------- | --------------------------- | ---------------------------------- |
| `.github/workflows/ci.yml`      | push / PR 到 `main`/`master` | typecheck + build + test + 上传 dist |
| `.github/workflows/release.yml` | tag `v*` / 手动触发             | 打包 + 测试 + 发布 npm                   |


发版流程见 [RELEASING.md](./RELEASING.md)。

## OpenClaw 官方文档

### Plugins

- [https://docs.openclaw.ai/tools/plugin](https://docs.openclaw.ai/tools/plugin)
- [https://docs.openclaw.ai/plugins/community](https://docs.openclaw.ai/plugins/community)
- [https://docs.openclaw.ai/plugins/bundles](https://docs.openclaw.ai/plugins/bundles)
- [https://docs.openclaw.ai/plugins/voice-call](https://docs.openclaw.ai/plugins/voice-call)

### Building plugins

- [https://docs.openclaw.ai/plugins/building-plugins](https://docs.openclaw.ai/plugins/building-plugins)
- [https://docs.openclaw.ai/plugins/sdk-channel-plugins](https://docs.openclaw.ai/plugins/sdk-channel-plugins)
- [https://docs.openclaw.ai/plugins/sdk-provider-plugins](https://docs.openclaw.ai/plugins/sdk-provider-plugins)
- [https://docs.openclaw.ai/plugins/sdk-migration](https://docs.openclaw.ai/plugins/sdk-migration)

### SDK reference

- [https://docs.openclaw.ai/plugins/sdk-overview](https://docs.openclaw.ai/plugins/sdk-overview)
- [https://docs.openclaw.ai/plugins/sdk-entrypoints](https://docs.openclaw.ai/plugins/sdk-entrypoints)
- [https://docs.openclaw.ai/plugins/sdk-runtime](https://docs.openclaw.ai/plugins/sdk-runtime)
- [https://docs.openclaw.ai/plugins/sdk-setup](https://docs.openclaw.ai/plugins/sdk-setup)
- [https://docs.openclaw.ai/plugins/sdk-testing](https://docs.openclaw.ai/plugins/sdk-testing)
- [https://docs.openclaw.ai/plugins/manifest](https://docs.openclaw.ai/plugins/manifest)
- [https://docs.openclaw.ai/plugins/architecture](https://docs.openclaw.ai/plugins/architecture)

### RabbitMQ STOMP 参考

- [https://www.rabbitmq.com/docs/stomp](https://www.rabbitmq.com/docs/stomp)

## 许可证

MIT

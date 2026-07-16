# OpenClaw Bridge

`@partme.ai/openclaw-bridge` 是面向 OpenClaw 2026.7.1 的 IM 上下文与消息观测桥。它不替代任何 IM 或 MQ Channel 插件，主要提供两项能力：

- 通过官方 `before_prompt_build` Hook，为已配置的 IM 渠道追加平台交互约束。
- 通过官方 `message_received`、`reply_payload_sending` Hook 观察真实收发载荷，再经公共 channel outbound adapter 将 `UnifiedMessage` 镜像到 MQ。

## 安装

```bash
openclaw plugins install @partme.ai/openclaw-bridge
```

Bridge 的清单 ID 是 `bridge`，配置应写入 `plugins.entries.bridge.config`。

## 配置示例

```json
{
  "plugins": {
    "entries": {
      "bridge": {
        "enabled": true,
        "config": {
          "channels": {
            "discord": {
              "enabled": true,
              "contextInjection": true,
              "forwardToMq": true,
              "mqChannel": "rabbitmq",
              "mqAccountId": "default",
              "topicPrefix": "openclaw/bridge/discord"
            },
            "wecom": {
              "enabled": true,
              "forwardToMq": true,
              "mqChannel": "mqtt"
            }
          },
          "delivery": {
            "maxAttempts": 3,
            "retryDelayMs": 250,
            "publishTimeoutMs": 5000,
            "maxPayloadBytes": 1048576
          }
        }
      }
    }
  }
}
```

只有 `channels` 中显式声明的来源渠道会被处理。未知来源渠道或 MQ 渠道会在启动时失败，避免静默回退后误投递。

## MQ 渠道

支持以下 outbound adapter ID：

- `mqtt`
- `mqtt-ws`（兼容旧别名 `web-mqtt`）
- `rabbitmq`
- `redis-stream`
- `rocketmq`
- `stomp`（兼容旧别名 `web-stomp`）
- `stomp-tcp`

MQ 插件必须独立安装并配置。MQTT、RabbitMQ、Redis Stream、RocketMQ 使用 `openclaw-direct-topic:v1:` 显式直达契约，不会把 OpenClaw 普通 durable reply 的 `deliveryQueueId` 误判成 Topic。STOMP 使用 `/topic/` destination。

默认 Topic：

- `openclaw/bridge/{sourceChannel}/inbound`
- `openclaw/bridge/{sourceChannel}/outbound`

可用 `topicPrefix` 覆盖前缀。

## 渠道范围

静态能力表包含 22 个渠道：20 个 OpenClaw 2026.7.1 stock 渠道、当前仓库的 `wecom`，以及外部 `dingtalk-connector`。其中飞书与 QQ 的当前 stock ID 分别是 `feishu`、`qqbot`；旧文档中的 `openclaw-lark` 已不再使用。

Bridge 只对实际安装、运行且在配置中启用的渠道生效，静态能力表不代表这些渠道已被安装或完成环境验收。

## 投递语义与边界

- Hook 会等待 outbound adapter 返回，并进行有界重试；每次重试复用同一个 `deliveryQueueId`。
- 单条 JSON 载荷受 `maxPayloadBytes` 限制。
- 进程退出会丢失尚未完成的内存重试，因此 Bridge 本身是 best-effort/at-least-once 观测镜像，不提供持久 Outbox。
- 需要跨重启恢复、DLQ、审计和运维回放时，应使用 `@partme.ai/openclaw-router` 的持久投递链路。
- Broker 超时后的实际结果可能未知，下游应按 `messageId`/`deliveryQueueId` 实现幂等。

## 开发验证

```bash
pnpm test
pnpm typecheck
pnpm build
npm pack --dry-run
```

## License

MIT

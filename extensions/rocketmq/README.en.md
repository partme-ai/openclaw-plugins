# OpenClaw RocketMQ

`@partme.ai/openclaw-rockermq` 是一个面向 OpenClaw 的 RocketMQ channel 插件 MVP，目标是把外部 RocketMQ 消息桥接到 OpenClaw agent，并把 agent 回复重新发布到 RocketMQ。

## 当前实现

- 使用 `defineChannelPluginEntry` / `defineSetupPluginEntry` 暴露标准 OpenClaw channel 插件入口
- 启动 `rocketmq-client-nodejs` 的 `Producer` 与 `PushConsumer`
- 支持显式 `topic + tag -> agentId` 绑定
- 支持标准回退主题：`openclaw.agent.<agentId>.in[.<peerId>]`
- 支持 `embedded-agent` / `subagent` / `reply-pipeline` 三种分发模式
- 提供 `/rockermq/health`、`/rockermq/stats`、`/rockermq/status` 状态路由
- 提供 `mq.publish` 调试工具

## 为什么这是优先方案

RocketMQ 与现有 `cloud-agents` / `base-mq` 的契合点更强：

- 业务侧已有 `topic/tag + producerGroup + consumerGroup + namesrv/proxy` 使用经验
- Java 侧现有 `base-mq` 已明确把 RocketMQ 作为主流实现之一
- 在 OpenClaw 里只需要复用“插件骨架 + agent 分发逻辑”，传输层直接对接 `rocketmq-client-nodejs`

## 最小配置示例

```json
{
  "channels": {
    "rockermq": {
      "endpoints": "127.0.0.1:8081",
      "namespace": "",
      "topicPrefix": "openclaw",
      "producer": {
        "groupId": "openclaw-rockermq-producer"
      },
      "consumer": {
        "groupId": "openclaw-rockermq-consumer",
        "subscriptions": [
          {
            "topic": "device.status",
            "filterExpression": "*"
          },
          {
            "topic": "openclaw.agent.support.in.device-1",
            "filterExpression": "*"
          }
        ]
      },
      "topicBindings": [
        {
          "topic": "device.status",
          "tag": "iot",
          "agentId": "iot-agent",
          "accountId": "default",
          "replyTopic": "device.command",
          "replyTag": "command"
        }
      ],
      "dispatch": {
        "mode": "embedded-agent",
        "timeoutMs": 120000,
        "reply": {
          "enabled": true
        }
      }
    }
  },
  "session": {
    "dmScope": "per-channel-peer"
  }
}
```

## 消息模型

### 入站

- 显式绑定优先：`topicBindings.topic + topicBindings.tag`
- 标准回退：`openclaw.agent.<agentId>.in[.<peerId>]`
- 载荷默认解析策略：优先读 JSON 中的 `text` 字段，否则回退原始文本

### 出站

- 优先使用会话中记录的 `replyTopic` / `replyTag`
- 否则按标准格式回退到 `openclaw.agent.<agentId>.out[.<peerId>]`

## 传输层注意事项

- 当前实现使用 `PushConsumer`，消费确认通过返回 `ConsumeResult.SUCCESS` / `FAILURE` 完成
- 重试由 RocketMQ broker / consumer group 机制接管，而不是像 RabbitMQ 那样手工维护 retry queue
- 该 MVP 暂未实现 request/reply RPC 工具，因为 RocketMQ 本身没有 RabbitMQ direct-reply-to 那种天然模型

## 开发命令

```bash
npm install
npm run typecheck
npm run build
```

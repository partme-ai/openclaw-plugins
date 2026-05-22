# 消息中间件插件统一目录规范

> **版本**: 1.0  
> **日期**: 2026-05-22  
> **范围**: mqtt, rabbitmq, rocketmq, redis-stream, stomp, web-mqtt, web-stomp, gotify

## 设计原则

1. **message-sdk 是唯一消息语义层**：ingress、dedup、dispatch、serialize。
2. **插件只做传输**：connect / subscribe / publish / ACK / 渠道 REST/WS。
3. **inbound.ts 是唯一 OpenClaw 入站入口**（gotify 可在 channel.ts 内联，等价于 inbound）。

## 通道 Archetype

| Archetype | 插件 | SDK 入站 | SDK dispatch |
|-----------|------|----------|--------------|
| Wire MQ | mqtt, rabbitmq, rocketmq, redis-stream, stomp, web-mqtt, web-stomp | `normalizeWireIngress` | `createChannelDispatch` |
| Transcript IM | gotify | `normalizeGotifyIngress` | `createTranscriptDispatch` |

## Wire MQ 标准目录

```
extensions/{plugin}/
├── src/
│   ├── index.ts
│   ├── channel.ts
│   ├── runtime.ts
│   ├── config.ts
│   ├── state.ts
│   ├── types.ts
│   ├── inbound.ts          # 薄封装 → SDK
│   ├── outbound.ts         # publish 封装
│   ├── transport/          # 协议栈
│   ├── routing/            # topic-router, session-mapper
│   ├── setup/              # onboarding, setup-entry, channel-setup-factory
│   └── openclaw-sdk.d.ts
├── test/
│   └── inbound.test.ts
├── openclaw.plugin.json
├── clawdbot.plugin.json
├── moltbot.plugin.json
├── package.json
└── README.zh-CN.md
```

## Transcript 标准目录（gotify）

```
src/
├── channel.ts
├── transport/     # ws-listener, gotify-api
├── routing/       # peer-resolver, message-mapper
├── policy/        # inbound-access
└── setup/
```

## Mandatory 文件（Wire）

| 文件 | SDK 依赖 |
|------|----------|
| `inbound.ts` | `normalizeWireIngress` + `createChannelDispatch` |
| `outbound.ts` | 无 |
| `test/inbound.test.ts` | mock SDK，含 mode 回归 |

## 禁止项

- `inbound.ts` 内直接调用 `runEmbeddedAgent` / `subagent.run`
- 插件内复制 `serializeForTransport` + dispatch 编排逻辑
- 自建幂等 Map（应使用 `createIdempotencyCache`）
- **本地拼接 sessionKey**（`getOrCreateSessionKey`、`agent:${agentId}:main` 硬编码等）
- `session-mapper` 生成 sessionKey（仅保存 replyTopic / destination 等出站元数据）

## sessionKey 约定（OpenClaw 核心）

Wire 插件入站 MUST 通过 SDK 调用 OpenClaw `resolveAgentRoute`：

```typescript
import {
  normalizeWireIngress,
  createChannelDispatch,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";

const { agentId, sessionKey } = await resolveChannelDispatchIdentity(rt as BridgePluginRuntime, {
  channel: "mqtt",
  accountId: route.accountId,
  peerId,
  chatType: "direct",
  agentId: route.agentId, // 可选，路由结果优先
});

upsertSessionContext(sessionKey, { peerId, replyTopic, ... }); // 不生成 key

await createChannelDispatch({
  mode: config.dispatch?.mode ?? "reply-pipeline",
  runtime: rt,
  channel, accountId, peerId, text, agentId, sessionKey,
  ...
});
```

`createChannelDispatch` 在未提供 `sessionKey` 时也会自动 resolve，但插件侧应显式 resolve 后写入 `session-mapper`。

## inbound.ts 模板

```typescript
const parsed = normalizeWireIngress({ rawPayload, mode, channel, idempotencyKey, idempotency });
if (!parsed.accepted) return;

await createChannelDispatch({
  mode: config.dispatch?.mode ?? "reply-pipeline",
  runtime: rt,
  channel, accountId, peerId, text: parsed.text, agentId, sessionKey,
  unified: parsed.unified,
  extra: { sessionKey, ... },
  timeoutMs: config.dispatch?.timeoutMs,
  replyEnabled: config.dispatch?.reply?.enabled,
  sessionId: `${channel}:${accountId}:${agentId}:${peerId}`,
  reply: {
    deliver: async ({ wire, runId }) => publish(replyTopic, wire, { correlationId: runId }),
    outboundFormat: config.payload.outboundFormat ?? "envelope",
    replyRoute: { routingKey: replyTopic }, // 或 topic/destination
  },
});
```

## SDK 导入约定

```typescript
import { createIdempotencyCache } from "@partme.ai/openclaw-message-sdk";
import {
  normalizeWireIngress,
  createChannelDispatch,
  resolveChannelDispatchIdentity,
  type BridgePluginRuntime,
} from "@partme.ai/openclaw-message-sdk/bridge";
```

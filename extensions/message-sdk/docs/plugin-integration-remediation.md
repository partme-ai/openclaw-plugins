# 插件 message-sdk 接入改造清单

> 对应规范：[plugin-structure-standard.md](./plugin-structure-standard.md)  
> SDK dispatch：[ARCHITECTURE.md](./ARCHITECTURE.md#dispatch-mode-矩阵wire-mq)

## 总览矩阵

| 插件 | Archetype | createChannelDispatch | 目录规范 | 测试 |
|------|-----------|----------------------|----------|------|
| mqtt | Wire | [x] | [x] | [x] |
| rabbitmq | Wire | [x] | [x] | [x] |
| rocketmq | Wire | [x] | [x] | [x] |
| redis-stream | Wire | [x] | [x] | [x] |
| stomp | Wire | [x] | [x] | [x] |
| web-mqtt | Wire | [x] | [x] | [x] |
| web-stomp | Wire | [x] | [x] | [x] |
| gotify | Transcript | N/A | [x] | [x] |

---

## mqtt

- [x] `inbound.ts` 使用 `createChannelDispatch`（mode=`reply-pipeline`）
- [x] 删除直接 `createWireDispatch` 调用（改经 channel dispatch）
- [x] 目录：`transport/`（broker, qos, acl, audit, gateway-mqtt）
- [x] 目录：`routing/`（topic-router, session-mapper）
- [x] 目录：`setup/`（onboarding, setup-entry, channel-setup-factory）
- [x] `config.ts` + `state.ts`（由 mqtt-state 重命名）
- [x] `test/inbound.test.ts` SDK 集成测试
- [x] Verify: `cd extensions/mqtt && pnpm test && pnpm exec tsc --noEmit`

## rabbitmq

- [x] 删除 `dispatchViaEmbeddedAgent` / `dispatchViaSubagent`
- [x] `inbound.ts` 使用 `createChannelDispatch`（三 mode）
- [x] 目录重组（同 mqtt 模板，保留 re-export shim）
- [x] `test/inbound.test.ts` 三 mode mock 测试
- [x] Verify: `cd extensions/rabbitmq && pnpm test`

## rocketmq

- [x] 合并 `rockermq-*` typo 文件 → `config.ts` / `state.ts`（canonical re-export）
- [x] 删除插件内 embedded/subagent dispatch
- [x] `inbound.ts` 使用 `createChannelDispatch`
- [x] 目录重组（保留 re-export shim）
- [x] Verify: `cd extensions/rocketmq && pnpm test && pnpm exec tsc --noEmit`

## redis-stream

- [x] `inbound.ts` 使用 `createChannelDispatch`
- [x] 测试从 `src/` 迁至 `test/`
- [x] 目录重组（transport/routing/setup + shim）
- [x] Verify: `cd extensions/redis-stream && pnpm test`（`functional.test.ts` 需 `REDIS_URL`）

## stomp

- [x] `inbound.ts` 使用 `createChannelDispatch`
- [x] 新增 `outbound.ts` 薄层
- [x] `transport/server.ts`
- [x] Verify: `cd extensions/stomp && pnpm test`

## web-mqtt

- [x] `inbound.ts` 使用 `createChannelDispatch`
- [x] 目录重组
- [x] Verify: `cd extensions/web-mqtt && pnpm test`

## web-stomp

- [x] `inbound.ts` 使用 `createChannelDispatch`
- [x] 目录重组 + `outbound.ts`
- [x] Verify: `cd extensions/web-stomp && pnpm test`

## gotify

- [x] 保持 `createTranscriptDispatch`（不引入 Wire mode）
- [x] `transport/`、`routing/`、`policy/`、`setup/`
- [x] 测试迁至 `test/`
- [x] Verify: `cd extensions/gotify && pnpm test`

---

## 全局门禁

- [x] message-sdk tests + tsc green（含 `test/wire-plugin-inbound-guard.test.ts`）
- [x] 8 插件 `package.json` 均依赖 `@partme.ai/openclaw-message-sdk`
- [x] Wire 插件 `inbound.ts` negative test：不得出现 `runEmbeddedAgent` / `subagent.run`
- [x] Wire 插件 `inbound.ts` MUST 使用 `resolveChannelDispatchIdentity`（或 `resolveChannelAgentRoute`）
- [x] Wire 插件 `inbound.ts` MUST NOT 使用 `getOrCreateSessionKey` / ``agent:${...}:main`` 硬编码
- [x] `session-mapper` 仅出站上下文，不导出 sessionKey 生成函数
- [x] Wire 插件补齐 `clawdbot.plugin.json` + `moltbot.plugin.json`（与 `openclaw.plugin.json` 对齐）

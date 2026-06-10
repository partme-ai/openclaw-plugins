# wecom-kf — Base Profile 映射说明

本插件采用 **Extended Profile** 语义分层；Base Profile 平铺文件为 **薄 shim**，指向 Extended 实现。

| Base Profile (`src/`) | Extended 实现 | 说明 |
|----------------------|---------------|------|
| `channel.ts` | `channel/channel.ts` | `ChannelPlugin` 定义 |
| `channel-setup-factory.ts` | `channel/onboarding.ts` | setup wizard |
| `setup-entry.ts` | `channel/channel.ts` | `defineSetupPluginEntry` |
| `runtime.ts` | `runtime/index.ts` | runtime getter/setter |
| `inbound.ts` | `dispatch/inbound-dispatcher.ts` | `dispatchKfMessage` / `handleCustomerMessage` |
| `outbound.ts` | `outbound/index.ts` | `wecomOutbound` 适配器 |
| `onboarding.ts` | `channel/onboarding.ts` | KF 配置向导 |
| `config.ts` | `config/index.ts` | 账号 / 路由 / 模板配置 |
| `types.ts` | `types/index.ts` | 领域类型 barrel |
| `transport/server.ts` | `webhook/callback.ts`, `webhook/handler.ts` | KF Webhook I/O |

## 持久化

- 原 `src/store/durable-json-map.ts` 已合并至 `src/state/durable-json-map.ts`（规范 §8.1：`store/` 与 `state/` 二选一）。

## 测试

- 单元测试仍在 `src/**/*.test.ts`（迁移期允许）；插件级冒烟见 `test/plugin.test.ts`。

参考：[OpenClaw-Plugin-Structure-Standard.md](../../doc/OpenClaw-Plugin-Structure-Standard.md)

# wecom — Extended Profile 映射说明

本插件采用 **Extended Profile**；Base Profile 入口文件保留在 `src/` 根目录，业务模块已迁入语义子目录。

## Base 入口（保留在 `src/` 根）

`index.ts`, `channel.ts`, `channel-setup-factory.ts`, `setup-entry.ts`, `runtime.ts`, `inbound.ts`, `outbound.ts`, `onboarding.ts`, `config.ts`, `types.ts`, `transport/server.ts`

## 根目录漂移 → 语义目录

| 原 `src/*.ts` | 现路径 |
|---------------|--------|
| `accounts.ts`, `dm-policy.ts`, `group-policy.ts`, `dynamic-routing.ts`, `streaming-config.ts`, `text-config.ts`, `templates.ts`, `utils.ts` | `config/`（`utils.ts` → `config/wecom-config.ts`） |
| `dynamic-agent.ts` | `channel/` |
| `monitor.ts` | `dispatch/ws-monitor.ts` |
| `chat-queue.ts`, `message-parser.ts`, `message-sender.ts`, `finish-thinking.ts`, `reqid-store.ts` | `dispatch/` |
| `probe.ts`, `runtime-api.ts` | `runtime/` |
| `media-handler.ts`, `media-path-guard.ts`, `media-uploader.ts`, `ws-media.ts` | `media/` |
| `outbound-reply.ts`, `target.ts`, `template-card-*.ts` | `outbound/` |
| `state-manager.ts`, `state-dir-resolve.ts` | `state/` |
| `http.ts`, `ws-reply-pipeline.ts` | `webhook/` |
| `webhook/helpers.ts` | `webhook/inbound-helpers.ts` |
| `const.ts`, `interface.ts`, `version.ts` | `types/` |
| `openclaw-compat.ts`, `timeout.ts` | `shared/` |

## 测试

- 模块单测：`src/**/*.test.ts`
- 插件级：`test/plugin.test.ts`

参考：[OpenClaw-Plugin-Structure-Standard.md](../../doc/OpenClaw-Plugin-Structure-Standard.md)

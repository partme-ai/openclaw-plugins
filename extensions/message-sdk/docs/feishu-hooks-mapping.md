# Feishu → message-sdk Hooks Mapping

> Phase 4 (T4-01). Reference: `research/openclaw/extensions/feishu/src/reply-dispatcher.ts`

| Feishu 模块 | SDK 目标 | 状态 |
|-------------|----------|------|
| `createReplyPrefixContext` | OpenClaw peer / `reply/bundle` | 插件直调 peer |
| `createChannelMessageReplyPipeline` | `lifecycle/typing-lifecycle` | 经 bundle 注入 |
| `resolveSendableOutboundReplyParts` | `pipeline/reply-parts` | SDK export |
| `preprocessOutboundReply` | `reply/create-dispatcher.ts` | SDK |
| `createPersistentDedupe` | `dedup/persistent-dedupe.ts` | SDK |
| `channel-ingress-runtime` policy | `ingress/policy.ts` | SDK hooks |
| `createFeishuReplyDispatcher` 全文 | `adapters/feishu/reply-hooks.ts` | 示例薄封装 |
| Feishu streaming card / Doc tools | — | **Non-Goal**（留插件） |

WeCom 可复用：`ingress/policy`（allowlist）、`dedup/persistent-dedupe`（webhook dedup 已切 SDK sync 实现）。

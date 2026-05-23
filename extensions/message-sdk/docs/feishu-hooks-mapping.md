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
| `createFeishuReplyDispatcher` 全文 | Feishu 插件本地 adapter | 渠道专属逻辑不进入 SDK |
| Feishu streaming card / Doc tools | — | **Non-Goal**（留插件） |

WeCom 可复用：`ingress/policy`（allowlist）、`dedup/persistent-dedupe`（webhook dedup 已切 SDK sync 实现）。

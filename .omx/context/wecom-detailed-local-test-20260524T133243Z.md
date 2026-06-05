# WeCom 插件详细本地测试 — 上下文快照

**UTC**: 20260524T133243Z  
**Workspace**: `/Users/wandl/workspaces/workspace-partme-ai/openclaw-plugins`  
**Branch**: `feature/v2026-05-22` (ahead 4)  
**OpenClaw CLI**: `/opt/homebrew/bin/openclaw` — 2026.5.20 (e510042)  
**Plugin**: `@partme.ai/wecom@2026.5.20`

## Preflight

- Git: 工作区含与 wecom 无关的 e2e/web-stomp 等改动，未动 wecom 源码。
- **配置修复（测试阻塞项）**: `~/.openclaw/openclaw.json` 第 828 行 `timeoutText` 后缺逗号，已补逗号使 JSON 可解析（未改动密钥）。
- OpenClaw 插件路径:
  - `~/.openclaw/npm/node_modules/@partme.ai/wecom/dist/index.js`
  - `~/.openclaw/extensions/wecom/`（overlay 同步 dist）

## Build & Install

```bash
pnpm --filter @partme.ai/openclaw-message-sdk build   # OK
pnpm --filter @partme.ai/wecom typecheck               # OK
pnpm --filter @partme.ai/wecom test                    # 21 files, 330 tests PASS
pnpm --filter @partme.ai/wecom build                     # OK
npm pack → /tmp/partme.ai-wecom-2026.5.20.tgz
rsync overlay → ~/.openclaw/extensions/wecom + ~/.openclaw/npm/.../wecom
openclaw gateway restart                               # OK
```

`openclaw plugins install <tgz>` 被 dangerous code patterns 拦截；overlay 安装成功。

## Config Summary (redacted)

| Key | Status |
|-----|--------|
| `channels.wecom.enabled` | true |
| `channels.wecom.defaultAccount` | default |
| `channels.wecom.media.maxBytes` | 52428800 |
| `welcomeText`, `thinkingText`, `toolStatusText`, `emptyReplyText`, `timeoutText` | 已设置 |
| `accounts.default.botId` | aibDAj...iqgW |
| `accounts.default.secret` | ***REDACTED*** |
| `accounts.bot2.name` | 测试机器人2 |
| `accounts.bot2.botId` | aibl0_...qe-N |
| `accounts.bot2.secret` | ***REDACTED*** |
| `connectionMode` | 未显式设置（Bot WS 由 botId+secret 推断） |
| `dmPolicy` / `allowFrom` | 未设置（插件默认策略） |
| `agent` / `corpId` / `corpSecret` | 未配置 |
| `token` / `encodingAESKey` | 未配置（非 Webhook 模式） |

## Live Probe Evidence

### `openclaw plugins list`

- `@partme.ai/wecom` — enabled — `~/.openclaw/npm/node_modules/@partme.ai/wecom/dist/index.js` — 2026.5.20

### `openclaw channels status --probe`

```
- 企业微信 bot2 (测试机器人2): enabled, configured, running, works
- 企业微信 default (企业微信): enabled, configured, running, works
```

### `openclaw channels capabilities --channel wecom`

```
企业微信 bot2: chatTypes=direct,group media blockStreaming | send,broadcast,sendAttachment | Probe: ok
企业微信 default: 同上 | Probe: ok
```

### Gateway logs (`~/Library/Logs/openclaw/gateway.log`)

- Plugin registered (full mode)
- default + bot2: WS connect → auth → Authentication successful → Authenticated
- Reply sent + **Reply ack received** for both accounts (startup enter_chat/welcome)

## Unit Test Inventory

- **21** test files, **330** tests, all PASS
- Key files: message-parser, inbound-helpers, media-path-guard, streaming-config, template-card-parser, reqid-store, markdown-strip, probe, command-auth, reply-pipeline

## Code Changes

- 无 wecom 源码提交
- 仅用户本地 `~/.openclaw/openclaw.json` 语法修复

## Outstanding Manual Steps

1. 从企业微信客户端向 default/bot2 发送「你好」验证完整 inbound→dispatch→outbound
2. 如需 Agent 模式 / Webhook / pairing：按 `doc/wecom/OpenClaw-WeCom-Configuration.zh-CN.md` 补配置

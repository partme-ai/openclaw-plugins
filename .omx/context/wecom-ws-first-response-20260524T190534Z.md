# WeCom WS First-Response Investigation Snapshot

**UTC**: 2026-05-24T19:05:34Z  
**Branch**: `feature/v2026-05-22` @ `1a209cf` (+ local perf commit pending)  
**OpenClaw**: 2026.5.20 (e510042)  
**Installed plugin**: `@partme.ai/wecom@2026.5.25-1` → `~/.openclaw/extensions/wecom/dist/index.js`

## Preflight

| Item | Result |
|------|--------|
| Git | clean working tree on `feature/v2026-05-22`, ahead 2 commits |
| OpenClaw CLI | `/opt/homebrew/bin/openclaw` |
| WeCom accounts | `default`, `bot2` (both WS connected after gateway restart) |
| Duplicate plugin dirs | `~/.openclaw/extensions/wecom.bak` present but not loaded; active source is `global:wecom` |
| Prior npm install | `~/.openclaw/npm/node_modules/@partme.ai/wecom` removed during CLI install |

## Root Cause Analysis

### Primary (user-visible 5–10s blank bubble)

1. **Immediate thinking disabled**: `processWeComMessageNow` Step 6 (`sendThinkingReply`) was commented out in both current and `research/wecom-openclaw-plugin`.
2. **Thinking deferred to Agent hook**: `ws-reply-pipeline.onReplyStartExtra` only sends protocol first frame when OpenClaw dispatch begins emitting reply blocks — typically after session record + agent routing + model TTFT (5–10s perceived delay).
3. **Default `sendThinkingMessage=true`** but user sees nothing until dispatch starts.

### Secondary (pre-dispatch overhead)

| Stage | Notes |
|-------|-------|
| `prepareWeComMessage` | Policy checks; media download even when no attachments (fixed: skip download when no URLs) |
| `chat-queue` | Per-chat serial; only delays when prior message still processing |
| `buildMessageContext` | Dynamic routing + session key resolution |
| `recordInboundSession` | Disk I/O before dispatch |

### Comparison with research/openclaw

- `research/wecom-openclaw-plugin/src/monitor.ts`: same commented Step 6; thinking only in reply pipeline hook.
- `research/openclaw-china/extensions/wecom`: separate codebase; no early-thinking pattern found.
- No research variant sends thinking before queue/dispatch for WS text messages.

## Changes Implemented

1. **Restore early thinking** in `processWeComMessageNow` when `sendThinkingMessage !== false`.
2. **Dedup flag** `MessageState.thinkingSentEarly` → `ws-reply-pipeline` skips duplicate `sendThinkingReply` in `onReplyStartExtra`.
3. **Skip media download** for text-only messages (no image/file URLs).
4. **Timing instrumentation** (`WECOM_WS_TIMING=1` or `OPENCLAW_DEBUG` contains `wecom-ws`): stages from `ws.received` through `thinking.early.sent`, `dispatch.start/end`.
5. **Tests**: `ws-reply-pipeline.test.ts` (dedup + timing helper), all 372 wecom tests pass.

## Install Evidence

```
openclaw plugins list → @partme.ai/wecom 2026.5.25-1 global:wecom/dist/index.js
rg thinkingSentEarly ~/.openclaw/extensions/wecom/dist/chunk-UOS3AFS5.js → match
openclaw gateway restart → [default|bot2] WebSocket connected
```

## Live Measurement

**Requires user action** — real inbound WS frames need WeCom client.

### Manual test procedure

1. Enable timing in gateway env (LaunchAgent or shell):
   ```bash
   export WECOM_WS_TIMING=1
   openclaw gateway restart
   ```
2. Send a **text-only** message to `default` or `bot2` bot in WeCom.
3. Observe:
   - User should see thinking/placeholder within ~1s (early frame).
   - Logs: `grep wecom-ws-timing /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log`
4. Expected timeline (text-only, idle queue):
   - `ws.received` → `parse.done` (<5ms)
   - `policy.*` (<50ms typical)
   - `prepare.done` / `queue.immediate`
   - `thinking.early.sent` (<200ms after queue.start, network dependent)
   - `dispatch.start` (varies, agent-bound)
   - First content block via stream (agent TTFT)

### enter_chat welcome

`event.enter_chat` → `replyWelcome` is **not** equivalent to inbound text first-response; separate code path.

## Remaining Tuning

- Consider async/non-blocking `recordInboundSession` before dispatch (if core API allows).
- Profile `buildMessageContext` / dynamic routing cache for hot accounts.
- Optional: flush status line immediately after early thinking when `footer.status=true`.
- Live before/after `thinking.early.sent` elapsedMs comparison once user sends test message.

## Commits

- Base optimization: `1a209cf` perf(wecom): add retry timeouts and queue observability
- This session: pending `perf(wecom): improve websocket first response timing`

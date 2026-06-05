# WeCom WS First Response Optimization — Context Snapshot

**UTC:** 2026-05-24T19:24:11Z  
**Workspace:** `openclaw-plugins`  
**Prior commit:** `44ccf02` (early thinking in `processWeComMessageNow`, text-only media skip, `WECOM_WS_TIMING`)

## Problem

- Local Mac perceived send→response ~3s; server 5–10s; target first **visible** response 1–2s.
- Evidence without `WECOM_WS_TIMING`: first WS reply 4–21ms, ack ~480ms, full Agent task 6–7s.
- Server may still run npm-published build **before** `44ccf02` (research plugin had early thinking **commented out**; only `onReplyStartExtra` sent thinking after Agent start).

## Root causes (code evidence)

| Cause | Location | Impact |
|-------|----------|--------|
| Early thinking only after queue dequeue | `ws-monitor.ts` `processWeComMessageNow` (pre-fix) | Queued messages show blank until prior task finishes (5–10s) |
| Early thinking after media download | `prepareWeComMessage` Step 4 before Step 5–7 | Image/file messages delay first frame until download completes |
| Fallback thinking tied to Agent | `ws-reply-pipeline.ts` `onReplyStartExtra` | Without early path, user waits for LLM/tool startup |
| `sendThinkingMessage` default true | `accounts.ts:230`, `wecom-config.ts:150` | Nested account merge preserves flag via `mergeChannelAccountConfig` |
| DM policy disk I/O | `dm-policy.ts` → pairing store reads | Server latency before any thinking (must stay after policy) |
| Full task latency ≠ first frame | `routeAndDispatchMessage` Agent dispatch | Expected 6–7s total; first frame should decouple |

## Changes (this session)

1. **`ws-early-thinking.ts`** — policy-passed thinking helper; uses non-blocking `sendThinkingReply`.
2. **`prepareWeComMessage`** — Step 3.5: send thinking **after policy**, **before** media download; preallocate `streamId`.
3. **`processWeComMessageNow`** — reuse entry `streamId` / `thinkingSentEarly`; skip duplicate send.
4. **`ws-timing.ts`** — `[wecom-ws-slow]` always logs stages ≥1000ms via `runtime.log`; `WECOM_WS_TIMING=1` logs all stages.

## Config notes

- `sendThinkingMessage`: default `true`; set `channels.wecom.sendThinkingMessage` or per-account override.
- `streaming=false` is OK: early thinking is protocol placeholder via `replyStreamNonBlocking`, independent of content streaming.
- Enable diagnostics: `WECOM_WS_TIMING=1` or `OPENCLAW_DEBUG=wecom-ws`.

## Server actions

1. Install local build or publish `@partme.ai/wecom` ≥ next patch after this commit.
2. Verify logs: `thinking.early.sent` in prepare (`elapsedMs` < 500), `[wecom-ws-slow]` for bottlenecks.
3. If still >2s before first frame: capture `policy.dm.done`, `media.done`, `queue.enqueued` stage timings.

## Tests added

- `ws-early-thinking.test.ts` — helper + slow timing
- `ws-monitor.prepare.test.ts` — thinking before media; thinking before queue
- `ws-reply-pipeline.test.ts` — dedup + slow stage logging

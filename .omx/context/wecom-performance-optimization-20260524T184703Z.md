# WeCom Performance Optimization — Context Snapshot

**Created:** 2026-05-24T18:47:03Z  
**Workspace:** `openclaw-plugins`  
**Packages:** `extensions/wecom`, `extensions/message-sdk`

## Task Statement

Continue Ralph workflow for WeCom performance/reliability improvements inspired by prior `research/openclaw` analysis. User approved: `/ralph 很好，按你的思路继续`.

## Desired Outcome

1. HTTP hot paths use OpenClaw SDK timeout/retry utilities with transient-only retry classification.
2. Keyed run queue exposes observability snapshots and wait warnings; WeCom chat queue logs compact depth/timing.
3. Webhook `startAgentForStream` dispatch gets explicit total timeout (parity with WS path).
4. MCP transport verbose logs gated behind debug flag; operational error/timing logs preserved.
5. Deterministic vitest coverage for retry classification, queue snapshot/warn, webhook timeout, MCP debug gating.
6. All verification commands pass; commit `perf(wecom): add retry timeouts and queue observability`.

## Known Evidence (Prior Analysis)

- `wecomFetch` had custom timeout merge but no retry; Agent API (`gettoken`, `sendMessage`, `uploadMedia`) and MCP HTTP lacked transient retry.
- WS dispatch wraps `dispatchReplyWithBufferedBlockDispatcher` in `withTimeout(resolveWecomAgentReplyTimeoutMs)`; webhook `startAgentForStream` did not — risk of hung stream blocking queue.
- `createKeyedRunQueue` only exposed `has` / `pendingKeys` / `size`; no depth or wait timing for ops.
- MCP `tool.ts` already gates heavy JSON logs via `debug-log.ts`; `transport.ts` still logs RPC payloads/method details unconditionally.
- OpenClaw SDK exports: `fetchWithTimeout`, `buildTimeoutAbortSignal` (`text-runtime`), `retryAsync` (`retry-runtime`).

## Constraints

- Preserve public config and behavior; minimal diffs.
- Retry only transient errors (network, 5xx, 429); never retry permanent 4xx, auth/signature/config, WeCom 60020 IP whitelist.
- No secrets; preserve unrelated working tree changes; no force push.
- Commit only (no publish/push unless requested).

## Likely Files

| Area | Files |
|------|-------|
| HTTP retry | `extensions/wecom/src/webhook/http.ts`, `http-retry.ts`, `http-retry.test.ts` |
| Agent API | `extensions/wecom/src/agent/api-client.ts` (via wecomFetch) |
| MCP | `extensions/wecom/src/mcp/transport.ts`, `transport.test.ts` |
| Queue SDK | `extensions/message-sdk/src/queue/keyed-run-queue.ts`, `.test.ts` |
| WeCom queue | `extensions/wecom/src/dispatch/chat-queue.ts`, `.test.ts` |
| Webhook timeout | `extensions/wecom/src/webhook/monitor.ts`, `monitor-dispatch.test.ts` |

## Verification Plan

```bash
pnpm --filter @partme.ai/openclaw-message-sdk test   # if SDK changed
pnpm --filter @partme.ai/wecom typecheck
pnpm --filter @partme.ai/wecom test
pnpm --filter @partme.ai/wecom build
git diff --check
```

## Remaining Risks (Post-Implementation)

- Retry on upload may duplicate side effects if WeCom server accepted but client timed out (low probability; bounded attempts).
- Queue depth is per-key chain length, not exact in-flight HTTP count.
- Webhook timeout aborts dispatch Promise but does not cancel in-flight LLM; stream still marked finished so queue advances.

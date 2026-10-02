# Task 6 / O6 candidate implementation and evidence

Status: **partial against the O6 specification**. Delivery start/final settlement can be correlated by a pseudonymous delivery ID, and installed-host metrics/recall are observable. Agent-root to delivery-span trace identity is still missing on OpenClaw 2026.9.6; do not check Task 6 complete.

## Fact path and scope

`message-sdk` writes `delivery.started` after the durable send-start record and emits one final `delivered`/`ambiguous` settlement after journal settlement or deferred broker confirmation; retry facts are separate. Router emits bounded retry, final failed/ambiguous, and current DLQ depth facts from its durable dispatcher. Memory and OpenMem emit completed search duration from their search `finally` paths. Each producer uses the public OpenClaw `emitDiagnosticEvent(log.record)` bus with logger namespace `partme.delivery-recall.v1`; Tracing and Prometheus subscribe through host diagnostics, independently of bundled SDK module instances. Diagnostics must be enabled. The bus is asynchronous and may drop facts, so metrics are best-effort observations, not an ACK ledger.

Tracing validates the versioned schema, fixed channel/outcome/plugin fields and `id_[a-f0-9]{24}` identities before exporting `delivery.started`, `delivery.settlement`, `delivery.retry`, `delivery.dlq`, and `memory.recall` spans. Delivery start and settlement share the same SHA-256 pseudonymous ID. Duplicate hook registrations in one host process claim the host diagnostic sequence only after acquiring a live backend, using a bounded 2048-entry process set; no backend or TraceStore owner is shared. Prometheus accepts only metric-bearing event kinds, never identity labels, and exposes current DLQ depth, retry/final settlement counters, recall duration, diagnostics enabled status, and host async queue loss. Stop invalidates each registration generation and unsubscribes before draining its accepted work.

## RED and GREEN

- RED: deferred SDK result lost its Agent run ID; `channel-dispatch.test.ts` expected the hashed run ID and failed. GREEN: callback captures the initial run ID; repeated confirmation does not duplicate final settlement. Ack-pending restart recovery has no persisted run ID and does not invent one.
- RED: SDK lacked a start fact linked to final settlement. GREEN: the deferred-send test requires a valid pseudonymous delivery ID on both facts in order.
- RED: two live Tracing registrations exported two spans for one host diagnostic event. GREEN: one export for the same event; after stopping the first registration, the second still exports a subsequent event. Existing concurrent stop/start and restart tests remain green.
- GREEN: forged `log.record` with raw IDs, invalid labels, or extra attributes is rejected; 10,000 distinct IDs keep metric series bounded; telemetry emitter exceptions preserve the business result.

Full local suites: message-sdk 538 pass; Tracing 86 pass; Prometheus 57 pass; Router 72 pass; MQTT 92 pass, 1 existing unit skip; Gotify 133 pass; Memory 52 pass; OpenMem 54 pass. All eight modules passed typecheck and build. `git diff --check` passed.

## Package audit and installed-host evidence

Final package audit: `scripts/e2e/reports/candidates/o6-final-20261003-0700/audit.json`. Parent independently checked raw archives, legal/unique tar members, manifests, packaged source/build bytes, source-map content, and installed artifact digests for SDK/MQTT/Router/Tracing. Gotify matched a previously audited raw archive. Consent pins were updated only after that approval.

Final E2E report: `scripts/e2e/reports/2026-10-02T23-21-03.718Z-mqtt+router+gotify+tracing+prometheus+memory-4f023413-02cc-4314-b7cb-1a73e8097451.json`; command used OpenClaw 2026.9.6 / Node v24.18.0 with `OPENCLAW_E2E_O6=1`, all six adapters **PASS**, no skipped install or browser phase (`skipCount=0`, `skipBrowser=false`), and all six individual `validateEvidence` checks **PASS**. No selected plugin requires a browser adapter. Gotify's report service URL is the actual `http://127.0.0.1:18081` endpoint. Gateway PID file and E2E Docker containers were removed after the run.

Real OTLP Collector received one `delivery.started` and one `delivery.settlement` span with the same pseudonymous delivery ID, plus `memory.recall`; the raw delivery ID was absent. Authenticated Tracing routes, denied anonymous/invalid requests, backend drain, and Gateway restart checks passed. Real Prometheus samples: `openclaw_delivery_telemetry_enabled=1`, MQTT delivered=1, Router failed=1, Router retries=1, current Router DLQ depth=2, Memory recall count=1, host queue drops=0; `/health` reported `best-effort`. Unauthorized scrape and shutdown/restart checks passed. These numeric values are persisted under the Tracing and Prometheus rows' `evidence.o6` fields.

## Remaining O6 gap and limits

Installed-host probe `scripts/e2e/reports/candidates/o6-trace-probe-safe-20261003/probe-conclusion.md` shows `delivery.started` emitted in guarded SDK delivery had **no active host trace scope**, while `agent_end` had a valid `ctx.trace.traceId`. The probe report preserves only pseudonymous IDs and validated trace ID. OpenClaw's public `emitDiagnosticEvent` can attach an active scope, but there was none at that call site; generating a new root would create a false correlation. Consequently Agent-root and delivery spans do not share a trace ID in the final Collector output. This unmet part of the O6 acceptance requires a supported host propagation point or a separately proven message identity path. Do not mark Task 6 complete. The final 27-plugin repository evidence gate remains for later consolidation.

import assert from "node:assert/strict";
import { test } from "node:test";
import { selectCompletedTurnTrace } from "./tracing.mjs";

const traceId = "a".repeat(32);
const oldTraceId = "b".repeat(32);
const rootSpanId = "c".repeat(16);
const nonce = "e2e-tracing-nonce-42";
const completed = {
  traceId,
  spanId: rootSpanId,
  name: "agent.run",
  status: "ok",
  startTimeMs: 100,
  endTimeMs: 200,
  attributes: { "openclaw.end_reason": "agent_end_success", "openclaw.message_text": `Return tracing fixture ${nonce}` },
};

function evidence(overrides = {}) {
  return {
    beforeTraceIds: new Set([oldTraceId]),
    nonce,
    summaries: [
      { traceId: oldTraceId, rootSpan: "agent.run", startTimeMs: 1, endTimeMs: 2 },
      { traceId, rootSpan: "agent.run", startTimeMs: 100, endTimeMs: 200 },
    ],
    spansByTraceId: new Map([[traceId, [completed]]]),
    collectorLog: `Span #0\nTrace ID: ${traceId}\nID: ${rootSpanId}\nName: agent.run`,
    ...overrides,
  };
}

test("turn evidence selects only a newly completed root exported under the same trace ID", () => {
  assert.deepEqual(selectCompletedTurnTrace(evidence()), { traceId, spanId: rootSpanId });
  assert.equal(selectCompletedTurnTrace(evidence({ beforeTraceIds: new Set([oldTraceId, traceId]) })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ collectorLog: `Span #0\nTrace ID: ${oldTraceId}\nID: ${rootSpanId}\nName: agent.run` })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ collectorLog: `Span #0\nTrace ID: ${traceId}\nID: ${"d".repeat(16)}\nName: agent.run` })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ collectorLog: `Span #0\nTrace ID: ${traceId}\nID: ${"d".repeat(16)}\nName: agent.run\nSpan #1\nTrace ID: ${oldTraceId}\nID: ${rootSpanId}\nName: agent.run` })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ collectorLog: `Span #0\nTrace ID: ${traceId}\nID: ${rootSpanId}\nName: unrelated` })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ nonce: "another-turn" })), null);
});

test("turn evidence rejects unfinished, failed and unexported roots", () => {
  for (const root of [
    { ...completed, endTimeMs: undefined },
    { ...completed, status: "unset" },
    { ...completed, status: "error" },
    { ...completed, attributes: {} },
  ]) {
    assert.equal(selectCompletedTurnTrace(evidence({ spansByTraceId: new Map([[traceId, [root]]]) })), null);
  }
  assert.equal(selectCompletedTurnTrace(evidence({ summaries: [{ traceId, rootSpan: "agent.run", startTimeMs: 100 }] })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ collectorLog: "" })), null);
});

test("O6 turn evidence requires both delivery spans in the Agent root trace", () => {
  const token = "id_" + "d".repeat(24);
  const root = `Span #0\nTrace ID: ${traceId}\nID: ${rootSpanId}\nName: agent.run`;
  const started = (id) => `Span #1\nTrace ID: ${id}\nID: ${"e".repeat(16)}\nName: delivery.started\n     -> partme.delivery_id: Str(${token})`;
  const settled = (id) => `Span #2\nTrace ID: ${id}\nID: ${"f".repeat(16)}\nName: delivery.settlement\n     -> partme.delivery_id: Str(${token})`;

  assert.equal(selectCompletedTurnTrace(evidence({ deliveryToken: token,
    collectorLog: `${root}\n${started(oldTraceId)}\n${settled(oldTraceId)}` })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ deliveryToken: token,
    collectorLog: `${root}\n${started(traceId)}\n${settled(oldTraceId)}` })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ deliveryToken: token,
    collectorLog: `${root}\n${started(traceId)}` })), null);
  assert.equal(selectCompletedTurnTrace(evidence({ deliveryToken: token,
    collectorLog: `${root}\nSpan #1\nTrace ID: ${traceId}\nName: delivery.started\n     -> partme.message_id: Str(${token})\n${settled(traceId)}` })), null);
  assert.deepEqual(selectCompletedTurnTrace(evidence({ deliveryToken: token,
    collectorLog: `${root}\n${started(traceId)}\n${settled(traceId)}` })), { traceId, spanId: rootSpanId });
});

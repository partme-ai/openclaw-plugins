import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRabbitmqSubagentTimeoutEvidence } from "./rabbitmq.mjs";

const evidence = {
  stats: {
    messagesReceived: 1, messagesNacked: 1, messagesAcked: 0,
    messagesSent: 0, lastError: "inbound_dropped:dispatch_error:subagent_wait status=timeout runId=run-123",
  },
  observedReplies: [],
  completionsStarted: 1,
  completionsFinished: 1,
};

test("timeout evidence requires a run id, exact wait status and one finished fixture turn", () => {
  assert.equal(assertRabbitmqSubagentTimeoutEvidence(evidence), "run-123");
  for (const status of ["error", "invalid", "pending"]) {
    assert.throws(() => assertRabbitmqSubagentTimeoutEvidence({
      ...evidence,
      stats: { ...evidence.stats, lastError: `inbound_dropped:dispatch_error:subagent_wait status=${status} runId=run-123` },
    }));
  }
  assert.throws(() => assertRabbitmqSubagentTimeoutEvidence({
    ...evidence, stats: { ...evidence.stats, lastError: "inbound_dropped:dispatch_error:subagent_wait status=timeout" },
  }));
  assert.throws(() => assertRabbitmqSubagentTimeoutEvidence({ ...evidence, completionsStarted: 0 }));
  assert.throws(() => assertRabbitmqSubagentTimeoutEvidence({ ...evidence, completionsFinished: 0 }));
  assert.throws(() => assertRabbitmqSubagentTimeoutEvidence({ ...evidence, observedReplies: ["unexpected"] }));
  assert.throws(() => assertRabbitmqSubagentTimeoutEvidence({
    ...evidence, stats: { ...evidence.stats, messagesAcked: 1 },
  }));
  assert.throws(() => assertRabbitmqSubagentTimeoutEvidence({
    ...evidence, stats: { ...evidence.stats, messagesSent: 1 },
  }));
});

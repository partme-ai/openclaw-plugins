import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRabbitmqSubagentTimeoutEvidence, assertRabbitmqDurableRedeliveryEvidence, assertRabbitmqAmbiguousDlqEvidence, observeRabbitmqRedeliveryQuietWindow } from "./rabbitmq.mjs";

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

test("durable redelivery requires two broker ACKs and only one Agent turn and reply", () => {
  const evidence = { before: { messagesReceived: 4, messagesAcked: 3 }, after: { messagesReceived: 6, messagesAcked: 5 },
    replies: ["reply"], completionsStarted: 1, completionsFinished: 1 };
  assert.doesNotThrow(() => assertRabbitmqDurableRedeliveryEvidence(evidence));
  assert.throws(() => assertRabbitmqDurableRedeliveryEvidence({ ...evidence, completionsStarted: 2 }));
  assert.throws(() => assertRabbitmqDurableRedeliveryEvidence({ ...evidence, after: { ...evidence.after, messagesAcked: 4 } }));
  assert.throws(() => assertRabbitmqDurableRedeliveryEvidence({ ...evidence, replies: ["reply", "duplicate"] }));
});

test("redelivery quiet window detects a duplicate Agent turn after the second ACK", async () => {
  const evidence = { before: { messagesReceived: 0, messagesAcked: 0 }, after: { messagesReceived: 2, messagesAcked: 2 },
    replies: ["reply"], completionsStarted: 1, completionsFinished: 1 };
  assert.doesNotThrow(() => assertRabbitmqDurableRedeliveryEvidence(evidence));
  const lateDuplicate = setTimeout(() => { evidence.completionsStarted += 1; evidence.replies.push("late duplicate"); }, 25);
  try {
    await assert.rejects(observeRabbitmqRedeliveryQuietWindow({ readEvidence: () => evidence, windowMs: 80, pollMs: 10 }),
      /reran the Agent or published a duplicate reply/);
  } finally {
    clearTimeout(lateDuplicate);
  }
});

test("ambiguous delivery observes confirmed DLQ custody and NACK with no Agent turn", () => {
  const evidence = { before: { messagesReceived: 4, messagesNacked: 2, messagesAcked: 2, messagesDeadLettered: 0, publishConfirmed: 2 },
    after: { messagesReceived: 5, messagesNacked: 3, messagesAcked: 2, messagesDeadLettered: 1, publishConfirmed: 3 },
    dlq: { content: "original", routingKey: "openclaw.agent.main.in", deliveryOutcome: "ambiguous" },
    completionsStarted: 0, completionsFinished: 0 };
  assert.doesNotThrow(() => assertRabbitmqAmbiguousDlqEvidence(evidence));
  assert.throws(() => assertRabbitmqAmbiguousDlqEvidence({ ...evidence, after: { ...evidence.after, messagesAcked: 3 } }));
  assert.throws(() => assertRabbitmqAmbiguousDlqEvidence({ ...evidence, dlq: undefined }));
});

/**
 * RabbitMQ external broker E2E adapter.
 */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/rabbitmq/package.json", import.meta.url));
const amqp = req("amqplib");

/** Assert the observed failure belongs to the exact timed-out subagent run. */
export function assertRabbitmqSubagentTimeoutEvidence({ stats, observedReplies, completionsStarted, completionsFinished }) {
  const match = /^inbound_dropped:dispatch_error:subagent_wait status=timeout runId=([A-Za-z0-9._~%-]+)$/.exec(stats?.lastError ?? "");
  if (!match) throw new Error(`Expected subagent wait timeout with runId, got ${stats?.lastError ?? "none"}`);
  if (stats.messagesReceived !== 1 || stats.messagesNacked !== 1 || stats.messagesAcked !== 0 || stats.messagesSent !== 0) {
    throw new Error("Subagent timeout transport settlement mismatch");
  }
  if (observedReplies.length !== 0) throw new Error(`Subagent timeout published a reply body: ${JSON.stringify(observedReplies)}`);
  if (completionsStarted !== 1 || completionsFinished !== 1) {
    throw new Error(`Subagent timeout fixture completion mismatch: started=${completionsStarted}, finished=${completionsFinished}`);
  }
  return match[1];
}

/** Require broker custody for both publishes while the Agent and reply run once. */
export function assertRabbitmqDurableRedeliveryEvidence({ before, after, replies, completionsStarted, completionsFinished }) {
  if (after.messagesReceived - before.messagesReceived !== 2 || after.messagesAcked - before.messagesAcked !== 2) {
    throw new Error("RabbitMQ redelivery did not receive and ACK both broker messages");
  }
  if (completionsStarted !== 1 || completionsFinished !== 1 || replies.length !== 1) {
    throw new Error("RabbitMQ redelivery reran the Agent or published a duplicate reply");
  }
}

/** Keep the reply consumer open while checking for delayed duplicate Agent work. */
export async function observeRabbitmqRedeliveryQuietWindow({ readEvidence, windowMs, pollMs = 100 }) {
  const deadline = Date.now() + windowMs;
  do {
    assertRabbitmqDurableRedeliveryEvidence(await readEvidence());
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, remaining)));
  } while (true);
}

/** Require both a confirmed DLQ copy and an original-delivery NACK; counters alone do not prove event order. */
export function assertRabbitmqAmbiguousDlqEvidence({ before, after, dlq, completionsStarted, completionsFinished }) {
  if (after.messagesReceived - before.messagesReceived !== 1 || after.messagesNacked - before.messagesNacked !== 1 ||
      after.messagesAcked !== before.messagesAcked || after.messagesDeadLettered - before.messagesDeadLettered !== 1 ||
      after.publishConfirmed - before.publishConfirmed < 1) {
    throw new Error("RabbitMQ ambiguous delivery settlement does not show a confirmed DLQ copy and NACK");
  }
  if (!dlq || dlq.content !== "original" || dlq.routingKey !== "openclaw.agent.main.in" || dlq.deliveryOutcome !== "ambiguous") {
    throw new Error("RabbitMQ ambiguous DLQ copy is missing original payload or custody headers");
  }
  if (completionsStarted !== 0 || completionsFinished !== 0) {
    throw new Error("RabbitMQ missing-identity delivery must not start the Agent");
  }
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testRabbitmq(ctx, results) {
  await runAdapterTest(
    ctx,
    "rabbitmq",
    async () => {
      let health;
      await ctx.waitFor(async () => {
        health = await ctx.gatewayFetch("/rabbitmq/health");
        return health.json?.data?.connected === true;
      }, { label: "rabbitmq channel connection", timeoutMs: 15_000 });
      const model = ctx.modelFixture;
      if (!model) throw new Error("rabbitmq E2E model fixture was not started by the orchestrator");
      const initialCompletions = model.metrics.completions;
      const initialFinishedCompletions = model.metrics.completionsFinished;
      const initialStatsResponse = await ctx.gatewayFetch("/rabbitmq/stats");
      if (!initialStatsResponse.ok) throw new Error(`/rabbitmq/stats → ${initialStatsResponse.status}`);
      const initialStats = initialStatsResponse.json?.data?.stats;
      if (!initialStats) throw new Error("RabbitMQ initial stats missing");
      const conn = await amqp.connect("amqp://127.0.0.1:5672");
      const ch = await conn.createConfirmChannel();
      const exchange = "openclaw-e2e";
      const inboundKey = "openclaw.agent.main.in";
      const replyKey = "openclaw.agent.main.out";
      const correlationId = `rabbitmq-e2e-${Date.now()}`;
      const subagentTimeout = process.env.OPENCLAW_E2E_RABBITMQ_SUBAGENT === "timeout";
      try {
        await ch.assertExchange(exchange, "topic", { durable: true });
        const queue = await ch.assertQueue("", { exclusive: true, autoDelete: true });
        await ch.bindQueue(queue.queue, exchange, replyKey);

        const observedReplies = [];
        const reply = subagentTimeout ? null : new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Timed out waiting for RabbitMQ Agent reply")), 30_000);
          timer.unref?.();
          void ch.consume(queue.queue, (message) => {
            if (!message) return;
            const raw = message.content.toString("utf8");
            observedReplies.push(raw);
            if (!raw.includes("openclaw e2e fixture reply")) return;
            clearTimeout(timer);
            resolve(raw);
          }, { noAck: true }).catch((error) => {
            clearTimeout(timer);
            reject(error);
          });
        });
        if (subagentTimeout) {
          await ch.consume(queue.queue, (message) => {
            if (message) observedReplies.push(message.content.toString("utf8"));
          }, { noAck: true });
        }

        const inboundPayload = Buffer.from(JSON.stringify({ ...ctx.pingPayload, text: "Return the RabbitMQ E2E fixture response." }));
        ch.publish(
          exchange,
          inboundKey,
          inboundPayload,
          { contentType: "application/json", correlationId, messageId: correlationId, persistent: true },
        );
        await ch.waitForConfirms();

        if (subagentTimeout) {
          await ctx.waitFor(async () => {
            const stats = await ctx.gatewayFetch("/rabbitmq/stats");
            const snapshot = stats.json?.data?.stats;
            return stats.ok && snapshot?.messagesNacked === 1 &&
              model.metrics.completionsFinished === initialFinishedCompletions + 1;
          }, { label: "rabbitmq subagent wait timeout and finished fixture completion", timeoutMs: 30_000 });
          await new Promise((resolve) => setTimeout(resolve, 2_000));
          const stats = await ctx.gatewayFetch("/rabbitmq/stats");
          if (!stats.ok) throw new Error(`/rabbitmq/stats → ${stats.status}`);
          assertRabbitmqSubagentTimeoutEvidence({
            stats: stats.json?.data?.stats,
            observedReplies,
            completionsStarted: model.metrics.completions - initialCompletions,
            completionsFinished: model.metrics.completionsFinished - initialFinishedCompletions,
          });
        } else {
          const rawReply = await reply;
          const envelope = JSON.parse(rawReply);
          if (envelope?.message?.text !== "openclaw e2e fixture reply") {
            throw new Error(`unexpected RabbitMQ reply envelope: ${rawReply}`);
          }
          if (envelope?.message?.source?.channel !== "rabbitmq") {
            throw new Error(`RabbitMQ reply source channel missing: ${rawReply}`);
          }
          if (envelope?.headers?.replyRoute?.routingKey !== replyKey) {
            throw new Error(`RabbitMQ reply route missing: ${rawReply}`);
          }

          await ctx.waitFor(async () => {
            const stats = await ctx.gatewayFetch("/rabbitmq/stats");
            return stats.json?.data?.stats?.messagesAcked >= initialStats.messagesAcked + 1;
          }, { label: "RabbitMQ first broker ACK", timeoutMs: 15_000 });
          ch.publish(exchange, inboundKey, inboundPayload,
            { contentType: "application/json", correlationId, messageId: correlationId, persistent: true });
          await ch.waitForConfirms();
          await ctx.waitFor(async () => {
            const stats = await ctx.gatewayFetch("/rabbitmq/stats");
            return stats.json?.data?.stats?.messagesReceived >= initialStats.messagesReceived + 2 &&
              stats.json?.data?.stats?.messagesAcked >= initialStats.messagesAcked + 2;
          }, { label: "RabbitMQ duplicate broker delivery ACK", timeoutMs: 15_000 });
          const afterRedelivery = (await ctx.gatewayFetch("/rabbitmq/stats")).json?.data?.stats;
          await observeRabbitmqRedeliveryQuietWindow({
            windowMs: 2_000,
            readEvidence: () => ({
              before: initialStats, after: afterRedelivery, replies: observedReplies,
              completionsStarted: model.metrics.completions - initialCompletions,
              completionsFinished: model.metrics.completionsFinished - initialFinishedCompletions,
            }),
          });

          // Bind a probe queue to the real DLX before publishing a reply-required message without an identity.
          const dlq = await ch.assertQueue("", { exclusive: true, autoDelete: true });
          await ch.bindQueue(dlq.queue, `${exchange}.dlx`, inboundKey);
          const dlqCopy = new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Timed out waiting for RabbitMQ ambiguous DLQ copy")), 15_000);
            timer.unref?.();
            void ch.consume(dlq.queue, (message) => {
              if (!message) return;
              clearTimeout(timer);
              resolve({ content: message.content.toString("utf8"),
                routingKey: message.properties.headers?.["x-original-routing-key"],
                deliveryOutcome: message.properties.headers?.["x-delivery-outcome"] });
            }, { noAck: true }).catch((error) => { clearTimeout(timer); reject(error); });
          });
          const beforeAmbiguous = afterRedelivery;
          ch.publish(exchange, inboundKey, Buffer.from("original"), { contentType: "text/plain", persistent: true });
          await ch.waitForConfirms();
          const observedDlq = await dlqCopy;
          await ctx.waitFor(async () => {
            const stats = await ctx.gatewayFetch("/rabbitmq/stats");
            return stats.json?.data?.stats?.messagesNacked >= beforeAmbiguous.messagesNacked + 1;
          }, { label: "RabbitMQ ambiguous DLQ copy and NACK", timeoutMs: 15_000 });
          const afterAmbiguous = (await ctx.gatewayFetch("/rabbitmq/stats")).json?.data?.stats;
          assertRabbitmqAmbiguousDlqEvidence({
            before: beforeAmbiguous, after: afterAmbiguous, dlq: observedDlq,
            completionsStarted: model.metrics.completions - initialCompletions - 1,
            completionsFinished: model.metrics.completionsFinished - initialFinishedCompletions - 1,
          });
        }
      } finally {
        await ch.close();
        await conn.close();
      }

      if (model.metrics.completions !== initialCompletions + 1) {
        throw new Error(`fixture completion delta=${model.metrics.completions - initialCompletions}, expected 1`);
      }
      if (model.metrics.completionsFinished !== initialFinishedCompletions + 1) {
        throw new Error("RabbitMQ fixture completion did not finish exactly once");
      }
      if (!subagentTimeout) await ctx.waitFor(async () => {
        const stats = await ctx.gatewayFetch("/rabbitmq/stats");
        const snapshot = stats.json?.data?.stats;
        return stats.ok
          && typeof snapshot?.messagesReceived === "number" && snapshot.messagesReceived > 0
          && typeof snapshot?.messagesAcked === "number" && snapshot.messagesAcked > 0
          && typeof snapshot?.messagesSent === "number" && snapshot.messagesSent > 0
          && typeof snapshot?.publishConfirmed === "number" && snapshot.publishConfirmed > 0;
      }, { label: "rabbitmq receive + reply publish confirm + deferred ack stats", timeoutMs: 15_000 });
    },
    { service: "docker:5672", method: process.env.OPENCLAW_E2E_RABBITMQ_SUBAGENT === "timeout"
      ? "subagent wait timeout + runId + fixture finished + NACK without ACK or publish"
      : process.env.OPENCLAW_E2E_RABBITMQ_SUBAGENT === "visible"
        ? "subagent reply + same-ID Broker redelivery quiet window + observed DLQ/NACK"
        : "real Agent Turn + same-ID Broker redelivery quiet window + observed DLQ/NACK" },
    results,
  );
}

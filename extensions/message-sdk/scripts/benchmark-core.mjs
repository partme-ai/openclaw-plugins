/**
 * 核心热路径的可重复微基准。
 *
 * 目标不是替代端到端压测，而是阻止消息信封解析/序列化或内存队列出现数量级退化。阈值刻意
 * 保守，普通 CI 机器也应稳定通过；输出 ops/s 供版本间趋势比较。
 */
import { performance } from "node:perf_hooks";
import {
  buildMessage,
  parseTransportPayload,
  serializeForTransport,
} from "../dist/index.js";
import { OutboundMessageQueue } from "../dist/queue/index.js";

const ENVELOPE_ITERATIONS = 50_000;
const QUEUE_ITERATIONS = 50_000;
const MIN_ENVELOPE_OPS_PER_SECOND = 2_000;
const MIN_QUEUE_OPS_PER_SECOND = 10_000;

function measure(iterations, operation) {
  const startedAt = performance.now();
  operation();
  const elapsedMs = performance.now() - startedAt;
  return {
    elapsedMs,
    operationsPerSecond: Math.round(
      (iterations / Math.max(elapsedMs, 0.001)) * 1000,
    ),
  };
}

const message = buildMessage({
  channel: "benchmark",
  accountId: "default",
  userId: "peer-1",
  text: "message-sdk benchmark payload",
});
const envelope = measure(ENVELOPE_ITERATIONS, () => {
  for (let index = 0; index < ENVELOPE_ITERATIONS; index += 1) {
    const wire = serializeForTransport({
      channel: message.source.channel,
      accountId: message.source.accountId,
      userId: message.source.userId,
      text: message.text,
      format: "envelope",
    });
    const parsed = parseTransportPayload(wire, "jsonTextOrPlain");
    if (parsed.text !== message.text)
      throw new Error("envelope round-trip mismatch");
  }
});

const queue = new OutboundMessageQueue({ maxSize: QUEUE_ITERATIONS });
const queueResult = measure(QUEUE_ITERATIONS * 2, () => {
  for (let index = 0; index < QUEUE_ITERATIONS; index += 1) {
    if (
      !queue.push({
        sessionKey: `session-${index % 100}`,
        message,
        text: message.text,
      })
    ) {
      throw new Error("queue unexpectedly rejected benchmark item");
    }
  }
  for (let index = 0; index < QUEUE_ITERATIONS; index += 1) {
    if (!queue.pop()) throw new Error("queue unexpectedly drained early");
  }
});

console.log(
  JSON.stringify(
    {
      envelope: { iterations: ENVELOPE_ITERATIONS, ...envelope },
      queue: { operations: QUEUE_ITERATIONS * 2, ...queueResult },
    },
    null,
    2,
  ),
);

if (envelope.operationsPerSecond < MIN_ENVELOPE_OPS_PER_SECOND) {
  throw new Error(
    `envelope throughput below ${MIN_ENVELOPE_OPS_PER_SECOND} ops/s`,
  );
}
if (queueResult.operationsPerSecond < MIN_QUEUE_OPS_PER_SECOND) {
  throw new Error(`queue throughput below ${MIN_QUEUE_OPS_PER_SECOND} ops/s`);
}

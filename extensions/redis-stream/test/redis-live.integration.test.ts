import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "redis";

import { resolveRedisChannelConfig } from "../src/config.js";
import { setRedisStreamRuntime } from "../src/runtime.js";
import { getStats, startRedisServer, stopRedisServer } from "../src/transport/server.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

function reachable(url: string): Promise<boolean> {
  const parsed = new URL(url);
  return new Promise((resolve) => {
    const socket = net.connect({ host: parsed.hostname, port: Number(parsed.port || 6379) });
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

const brokerUp = await reachable(REDIS_URL);

function configFor(suffix: string, overrides: Record<string, unknown> = {}) {
  return resolveRedisChannelConfig({
    channels: {
      "redis-stream": {
        url: REDIS_URL,
        channelMode: "stream",
        defaultAgentId: "main",
        stream: {
          inboundKey: `openclaw:it:${suffix}:in`,
          outboundKey: `openclaw:it:${suffix}:out`,
          deadLetterKey: `openclaw:it:${suffix}:dlq`,
          consumerGroup: `openclaw-it-${suffix}`,
          consumerName: `consumer-${process.pid}-${suffix}`,
          blockMs: 50,
          count: 10,
          pendingClaimIdleMs: 50,
          maxAttempts: 2,
          maxLen: 1000,
          ...overrides,
        },
      },
    },
  });
}

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}

describe.skipIf(!brokerUp)("redis-stream live integration", () => {
  const keys = new Set<string>();

  afterEach(async () => {
    await stopRedisServer();
    setRedisStreamRuntime(null as never);
    if (keys.size > 0) {
      const cleanup = createClient({ url: REDIS_URL });
      await cleanup.connect();
      await cleanup.del([...keys]);
      await cleanup.quit();
      keys.clear();
    }
  });

  it("XREADGROUP dispatches, XADDs the durable reply, and ACKs", async () => {
    const suffix = `success-${Date.now()}`;
    const config = configFor(suffix);
    keys.add(config.stream.inboundKey).add(config.stream.outboundKey).add(config.stream.deadLetterKey);
    setRedisStreamRuntime({
      config: {},
      channel: {
        routing: {
          resolveAgentRoute: async () => ({ agentId: "main", sessionKey: `agent:main:direct:${suffix}` }),
        },
        reply: {
          finalizeInboundContext: async (params: Record<string, unknown>) => params,
          createReplyDispatcherWithTyping: ({ deliver }: { deliver: (value: { text: string }) => Promise<void> }) => ({ deliver }),
          dispatchReplyFromConfig: async ({ dispatcher }: { dispatcher: { deliver: (value: { text: string }) => Promise<void> } }) => {
            await dispatcher.deliver({ text: "live redis reply" });
          },
        },
      },
    } as never);

    await startRedisServer(config);
    const producer = createClient({ url: REDIS_URL });
    await producer.connect();
    const id = await producer.xAdd(config.stream.inboundKey, "*", {
      text: "live redis request",
      agentId: "main",
      peerId: "device-1",
      replyStream: config.stream.outboundKey,
    });

    await waitUntil(async () => (await producer.xLen(config.stream.outboundKey)) === 1);
    const pending = await producer.xPending(config.stream.inboundKey, config.stream.consumerGroup);
    const replies = await producer.xRange(config.stream.outboundKey, "-", "+");
    expect(pending.pending).toBe(0);
    expect(replies[0]?.message.text).toContain("live redis reply");
    expect(getStats().messagesAcked).toBeGreaterThan(0);
    expect(id).toMatch(/^\d+-\d+$/);
    await producer.quit();
  });

  it("reclaims failures and atomically moves exhausted entries to the DLQ", async () => {
    const suffix = `dlq-${Date.now()}`;
    const config = configFor(suffix);
    keys.add(config.stream.inboundKey).add(config.stream.outboundKey).add(config.stream.deadLetterKey);
    setRedisStreamRuntime(null as never);

    await startRedisServer(config);
    const producer = createClient({ url: REDIS_URL });
    await producer.connect();
    const sourceId = await producer.xAdd(config.stream.inboundKey, "*", {
      text: "always fails",
      agentId: "main",
    });

    await waitUntil(async () => (await producer.xLen(config.stream.deadLetterKey)) === 1);
    const pending = await producer.xPending(config.stream.inboundKey, config.stream.consumerGroup);
    const deadLetters = await producer.xRange(config.stream.deadLetterKey, "-", "+");
    expect(pending.pending).toBe(0);
    expect(deadLetters[0]?.message._sourceId).toBe(sourceId);
    expect(deadLetters[0]?.message._deliveryCount).toBe("2");
    expect(getStats().messagesDeadLettered).toBeGreaterThan(0);
    await producer.quit();
  });
});

/**
 * Optional live RocketMQ integration — skipped when proxy port is closed.
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { Producer } from "rocketmq-client-nodejs";
import { DEFAULT_ROCKERMQ_CONFIG } from "../src/config.js";
import { startRockermqServer, stopRockermqServer } from "../src/transport/server.js";

const ENDPOINTS = process.env.ROCKETMQ_ENDPOINTS ?? DEFAULT_ROCKERMQ_CONFIG.endpoints;

function parseEndpoint(endpoints: string): { host: string; port: number } {
  const [host, portRaw] = endpoints.split(":");
  return { host: host || "127.0.0.1", port: Number(portRaw || 8081) };
}

function tcpReachable(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

const { host, port } = parseEndpoint(ENDPOINTS);
const brokerUp = await tcpReachable(host, port);

describe.skipIf(!brokerUp)("rocketmq docker integration", () => {
  afterEach(async () => {
    await stopRockermqServer();
  });

  it("PushConsumer receives published message", async () => {
    const topic = `openclaw-it-${Date.now()}`;
    const received: string[] = [];

    const cfg = {
      ...DEFAULT_ROCKERMQ_CONFIG,
      endpoints: ENDPOINTS,
      consumer: {
        ...DEFAULT_ROCKERMQ_CONFIG.consumer,
        groupId: `openclaw-it-consumer-${Date.now()}`,
        subscriptions: [{ topic, filterExpression: "*" }],
      },
    };

    await startRockermqServer(cfg, async (event) => {
      received.push(event.body.toString("utf-8"));
      return { ok: true };
    });

    const producer = new Producer({
      endpoints: ENDPOINTS,
      namespace: "",
      requestTimeout: 5000,
    });
    await producer.startup();
    await producer.send({
      topic,
      tag: "*",
      body: Buffer.from(JSON.stringify({ text: "rocketmq integration ping" })),
    });
    await producer.shutdown();

    const deadline = Date.now() + 15000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toContain("integration ping");
  }, 30000);
});

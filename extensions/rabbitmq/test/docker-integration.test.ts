/**
 * Optional live RabbitMQ integration — skipped when broker port is closed.
 */
import net from "node:net";
import { describe, it, expect, afterEach } from "vitest";
import { DEFAULT_RABBITMQ_CONFIG } from "../src/config.js";
import {
  startRabbitmqServer,
  stopRabbitmqServer,
  publishMessage,
} from "../src/transport/server.js";

const RABBITMQ_URL = process.env.RABBITMQ_URL ?? "amqp://localhost:5672";

function parseAmqpPort(url: string): number {
  try {
    return Number(new URL(url).port || 5672);
  } catch {
    return 5672;
  }
}

function tcpReachable(port: number, host = "127.0.0.1", timeoutMs = 1500): Promise<boolean> {
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

const brokerUp = await tcpReachable(parseAmqpPort(RABBITMQ_URL));

describe.skipIf(!brokerUp)("rabbitmq docker integration", () => {
  afterEach(async () => {
    await stopRabbitmqServer();
  });

  it("publish → consume round-trip via transport server", async () => {
    const exchange = `openclaw-it-${Date.now()}`;
    const routingKey = "openclaw.agent.main.in.integration-peer";
    const received: string[] = [];

    const cfg = {
      ...DEFAULT_RABBITMQ_CONFIG,
      url: RABBITMQ_URL,
      exchange,
      queue: { ...DEFAULT_RABBITMQ_CONFIG.queue, name: `openclaw-it-q-${Date.now()}` },
      subscribeTopics: ["openclaw.#"],
    };

    await startRabbitmqServer(cfg, async (event) => {
      received.push(event.content.toString("utf-8"));
      return { ok: true };
    });

    await publishMessage(routingKey, JSON.stringify({ text: "integration ping" }));

    const deadline = Date.now() + 5000;
    while (received.length === 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(received.length).toBeGreaterThan(0);
    expect(received[0]).toContain("integration ping");
  }, 20000);
});

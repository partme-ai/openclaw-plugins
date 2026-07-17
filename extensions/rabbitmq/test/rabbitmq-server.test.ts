import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { DEFAULT_RABBITMQ_CONFIG } from "../src/config.js";

type ConsumeCb = (msg: any) => void;

let consumeCb: ConsumeCb | null = null;

const consumeCh = {
  assertExchange: vi.fn(),
  assertQueue: vi.fn().mockResolvedValue({ queue: "q" }),
  bindQueue: vi.fn(),
  prefetch: vi.fn(),
  cancel: vi.fn(),
  consume: vi.fn(async (_q: string, cb: ConsumeCb) => {
    consumeCb = cb;
    return { consumerTag: "ctag" };
  }),
  ack: vi.fn(),
  nack: vi.fn(),
  close: vi.fn(),
};

const publishCh = Object.assign(new EventEmitter(), {
  assertExchange: vi.fn(),
  publish: vi.fn((_exchange: string, _routingKey: string, _content: Buffer, _options: unknown, callback?: (error: Error | null) => void) => {
    callback?.(null);
    return true;
  }),
  close: vi.fn(),
});

const requestCh = Object.assign(new EventEmitter(), {
  consume: vi.fn(async (_q: string, _cb: any) => {
    requestCh._cb = _cb;
    return { consumerTag: "rtag" };
  }),
  publish: vi.fn((_exchange: string, _routingKey: string, _content: Buffer, _options: unknown, callback?: (error: Error | null) => void) => {
    callback?.(null);
    return true;
  }),
  close: vi.fn(),
  _cb: null as any,
});

const connection = {
  createChannel: vi.fn(),
  createConfirmChannel: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
};

vi.mock("amqplib", () => ({
  default: {
    connect: vi.fn(async () => connection),
  },
}));

function sampleMsg(overrides: Record<string, unknown> = {}) {
  return {
    content: Buffer.from("hi"),
    fields: { routingKey: "rk" },
    properties: {},
    ...overrides,
  };
}

describe("rabbitmq-server", () => {
  let startRabbitmqServer: typeof import("../src/transport/server.js").startRabbitmqServer;
  let stopRabbitmqServer: typeof import("../src/transport/server.js").stopRabbitmqServer;
  let requestMessage: typeof import("../src/transport/server.js").requestMessage;
  let publishMessage: typeof import("../src/transport/server.js").publishMessage;

  beforeEach(() => {
    consumeCb = null;
    vi.clearAllMocks();
    connection.createChannel.mockImplementationOnce(async () => consumeCh as any);
    connection.createChannel.mockImplementation(async () => requestCh as any);
    connection.createConfirmChannel
      .mockImplementationOnce(async () => publishCh as any)
      .mockImplementation(async () => requestCh as any);
  });

  afterEach(async () => {
    if (stopRabbitmqServer) {
      await stopRabbitmqServer();
    }
  });

  it("acks only after inbound handler resolves", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, requestMessage, publishMessage } = await import("../src/transport/server.js"));
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    await startRabbitmqServer(
      { ...DEFAULT_RABBITMQ_CONFIG, consume: { ...DEFAULT_RABBITMQ_CONFIG.consume, prefetch: 1, concurrency: 1 } },
      async () => {
        await gate;
        return { ok: true as const };
      },
    );

    expect(consumeCb).not.toBeNull();
    consumeCb?.(sampleMsg());

    expect(consumeCh.ack).toHaveBeenCalledTimes(0);
    release?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(consumeCh.ack).toHaveBeenCalledTimes(1);
    expect(consumeCh.nack).toHaveBeenCalledTimes(0);
  });

  it("defers ack until delivery.ack() in manual mode", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer } = await import("../src/transport/server.js"));
    let ackedDuringHandler = false;

    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async (event) => {
      expect(consumeCh.ack).toHaveBeenCalledTimes(0);
      event.delivery.ack();
      ackedDuringHandler = true;
      return { ok: true as const, ackMode: "manual" as const };
    });

    consumeCb?.(sampleMsg());
    await new Promise((r) => setTimeout(r, 0));

    expect(ackedDuringHandler).toBe(true);
    expect(consumeCh.ack).toHaveBeenCalledTimes(1);
    expect(consumeCh.nack).toHaveBeenCalledTimes(0);
  });

  it("nacks when manual mode returns without settling delivery", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer } = await import("../src/transport/server.js"));

    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async () => {
      return { ok: true as const, ackMode: "manual" as const };
    });

    consumeCb?.(sampleMsg());
    await new Promise((r) => setTimeout(r, 0));

    expect(consumeCh.ack).toHaveBeenCalledTimes(0);
    expect(consumeCh.nack).toHaveBeenCalledTimes(1);
    expect(consumeCh.nack).toHaveBeenCalledWith(expect.anything(), false, false);
  });

  it("nacks and requeues on handler error when configured", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, requestMessage } = await import("../src/transport/server.js"));
    await startRabbitmqServer(
      {
        ...DEFAULT_RABBITMQ_CONFIG,
        retry: { ...DEFAULT_RABBITMQ_CONFIG.retry, enabled: false },
        consume: { ...DEFAULT_RABBITMQ_CONFIG.consume, requeueOnError: true },
      },
      async () => {
        throw new Error("boom");
      },
    );

    consumeCb?.(sampleMsg());
    await new Promise((r) => setTimeout(r, 0));

    expect(consumeCh.nack).toHaveBeenCalledTimes(1);
    expect(consumeCh.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });

  it("supports direct reply-to requestMessage", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, requestMessage } = await import("../src/transport/server.js"));
    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async () => ({ ok: true as const }));
    const promise = requestMessage({ queue: "rpc_queue", payload: JSON.stringify({ a: 1 }), timeoutMs: 1000, correlationId: "cid" });
    expect(requestCh.publish).toHaveBeenCalledTimes(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(requestCh.publish).toHaveBeenCalledTimes(1);
    expect(requestCh.publish).toHaveBeenCalledWith(
      "",
      "rpc_queue",
      expect.any(Buffer),
      expect.objectContaining({ mandatory: true, persistent: true, replyTo: "amq.rabbitmq.reply-to" }),
      expect.any(Function),
    );

    requestCh._cb?.({
      content: Buffer.from(JSON.stringify({ ok: true })),
      properties: { correlationId: "cid" },
    });

    const result = await promise;
    expect(result.correlationId).toBe("cid");
    expect(result.payload).toContain("ok");
  });

  it("waits for publisher confirm and persists outbound messages by default", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, publishMessage } = await import("../src/transport/server.js"));
    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async () => ({ ok: true as const }));

    await publishMessage("openclaw.agent.main.out.device-1", "reply");

    expect(publishCh.publish).toHaveBeenCalledWith(
      DEFAULT_RABBITMQ_CONFIG.exchange,
      "openclaw.agent.main.out.device-1",
      expect.any(Buffer),
      expect.objectContaining({ persistent: true, mandatory: true }),
      expect.any(Function),
    );
  });

  it("rejects an unroutable mandatory publish instead of reporting false success", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, publishMessage } = await import("../src/transport/server.js"));
    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async () => ({ ok: true as const }));
    publishCh.publish.mockImplementationOnce((_exchange, routingKey, _content, options: any, callback) => {
      publishCh.emit("return", {
        fields: { routingKey },
        properties: { headers: options.headers },
        content: Buffer.from("reply"),
      });
      callback?.(null);
      return true;
    });

    await expect(publishMessage("missing.route", "reply")).rejects.toThrow("unroutable");
  });

  it("validates RPC queue and timeout before opening a channel", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, requestMessage } = await import("../src/transport/server.js"));
    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async () => ({ ok: true as const }));

    await expect(requestMessage({ queue: " ", payload: "{}", timeoutMs: 1000 })).rejects.toThrow("queue is required");
    await expect(requestMessage({ queue: "rpc", payload: "{}", timeoutMs: 0 })).rejects.toThrow("positive integer");
  });

  it("computes bounded reconnect delay with deterministic jitter", async () => {
    const { computeReconnectDelay } = await import("../src/transport/server.js");
    expect(computeReconnectDelay(DEFAULT_RABBITMQ_CONFIG, 0, () => 0.5)).toBe(5000);
    expect(computeReconnectDelay(DEFAULT_RABBITMQ_CONFIG, 10, () => 0.5)).toBe(60000);
    expect(computeReconnectDelay(DEFAULT_RABBITMQ_CONFIG, 0, () => 0)).toBe(4000);
    expect(computeReconnectDelay(DEFAULT_RABBITMQ_CONFIG, 0, () => 1)).toBe(6000);
  });

  it("confirm-publishes failures to retry exchange and exhausted messages to DLQ", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer } = await import("../src/transport/server.js"));
    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async () => ({ ok: false as const, reason: "boom" }));

    consumeCb?.(sampleMsg());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publishCh.publish).toHaveBeenCalledWith(
      `${DEFAULT_RABBITMQ_CONFIG.exchange}.retry`,
      "rk",
      expect.any(Buffer),
      expect.objectContaining({ headers: expect.objectContaining({ "x-attempt": 1 }) }),
      expect.any(Function),
    );

    publishCh.publish.mockClear();
    consumeCb?.(sampleMsg({ properties: { headers: { "x-attempt": DEFAULT_RABBITMQ_CONFIG.retry.maxAttempts } } }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(publishCh.publish).toHaveBeenCalledWith(
      `${DEFAULT_RABBITMQ_CONFIG.exchange}.dlx`,
      "rk",
      expect.any(Buffer),
      expect.objectContaining({ headers: expect.objectContaining({ "x-final-attempt": DEFAULT_RABBITMQ_CONFIG.retry.maxAttempts }) }),
      expect.any(Function),
    );
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DEFAULT_RABBITMQ_CONFIG } from "../src/rabbitmq-config.js";

type ConsumeCb = (msg: any) => void;

let consumeCb: ConsumeCb | null = null;

const consumeCh = {
  assertExchange: vi.fn(),
  assertQueue: vi.fn().mockResolvedValue({ queue: "q" }),
  bindQueue: vi.fn(),
  prefetch: vi.fn(),
  consume: vi.fn(async (_q: string, cb: ConsumeCb) => {
    consumeCb = cb;
    return { consumerTag: "ctag" };
  }),
  ack: vi.fn(),
  nack: vi.fn(),
  close: vi.fn(),
};

const publishCh = {
  publish: vi.fn(),
  close: vi.fn(),
};

const requestCh = {
  consume: vi.fn(async (_q: string, _cb: any) => {
    requestCh._cb = _cb;
    return { consumerTag: "rtag" };
  }),
  sendToQueue: vi.fn(),
  close: vi.fn(),
  _cb: null as any,
};

const connection = {
  createChannel: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
};

vi.mock("amqplib", () => ({
  default: {
    connect: vi.fn(async () => connection),
  },
}));

describe("rabbitmq-server", () => {
  let startRabbitmqServer: typeof import("../src/rabbitmq-server.js").startRabbitmqServer;
  let stopRabbitmqServer: typeof import("../src/rabbitmq-server.js").stopRabbitmqServer;
  let requestMessage: typeof import("../src/rabbitmq-server.js").requestMessage;

  beforeEach(() => {
    consumeCb = null;
    vi.clearAllMocks();
    connection.createChannel.mockImplementationOnce(async () => consumeCh as any);
    connection.createChannel.mockImplementationOnce(async () => publishCh as any);
    connection.createChannel.mockImplementation(async () => requestCh as any);
  });

  afterEach(async () => {
    if (stopRabbitmqServer) {
      await stopRabbitmqServer();
    }
  });

  it("acks only after inbound handler resolves", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, requestMessage } = await import("../src/rabbitmq-server.js"));
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
    consumeCb?.({
      content: Buffer.from("hi"),
      fields: { routingKey: "rk" },
      properties: {},
    });

    expect(consumeCh.ack).toHaveBeenCalledTimes(0);
    release?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(consumeCh.ack).toHaveBeenCalledTimes(1);
    expect(consumeCh.nack).toHaveBeenCalledTimes(0);
  });

  it("nacks and requeues on handler error when configured", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, requestMessage } = await import("../src/rabbitmq-server.js"));
    await startRabbitmqServer(
      { ...DEFAULT_RABBITMQ_CONFIG, consume: { ...DEFAULT_RABBITMQ_CONFIG.consume, requeueOnError: true } },
      async () => {
        throw new Error("boom");
      },
    );

    consumeCb?.({
      content: Buffer.from("hi"),
      fields: { routingKey: "rk" },
      properties: {},
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(consumeCh.nack).toHaveBeenCalledTimes(1);
    expect(consumeCh.nack).toHaveBeenCalledWith(expect.anything(), false, true);
  });

  it("supports direct reply-to requestMessage", async () => {
    ({ startRabbitmqServer, stopRabbitmqServer, requestMessage } = await import("../src/rabbitmq-server.js"));
    await startRabbitmqServer(DEFAULT_RABBITMQ_CONFIG, async () => ({ ok: true as const }));
    const promise = requestMessage({ queue: "rpc_queue", payload: JSON.stringify({ a: 1 }), timeoutMs: 1000, correlationId: "cid" });
    expect(requestCh.sendToQueue).toHaveBeenCalledTimes(0);
    await new Promise((r) => setTimeout(r, 0));
    expect(requestCh.sendToQueue).toHaveBeenCalledTimes(1);

    requestCh._cb?.({
      content: Buffer.from(JSON.stringify({ ok: true })),
      properties: { correlationId: "cid" },
    });

    const result = await promise;
    expect(result.correlationId).toBe("cid");
    expect(result.payload).toContain("ok");
  });
});

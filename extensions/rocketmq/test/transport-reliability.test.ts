import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  producerStartup: vi.fn<() => Promise<void>>(),
  producerShutdown: vi.fn<() => Promise<void>>(),
  producerSend: vi.fn(),
  consumerStartup: vi.fn<() => Promise<void>>(),
  consumerShutdown: vi.fn<() => Promise<void>>(),
  consumerForward:
    vi.fn<
      () => Promise<{ getStatus: () => { toObject: () => { code: number } } }>
    >(),
  consumerOptions: undefined as Record<string, unknown> | undefined,
  consumerInstance: undefined as { getRetryPolicy?: () => unknown } | undefined,
}));

vi.mock("rocketmq-client-nodejs", () => ({
  ConsumeResult: { SUCCESS: "SUCCESS", FAILURE: "FAILURE" },
  ExponentialBackoffRetryPolicy: class {
    constructor(
      readonly maxAttempts: number,
      readonly initialDelayMs: number,
      readonly maxDelayMs: number,
      readonly multiplier: number,
    ) {}
  },
  Producer: class {
    constructor(_options: Record<string, unknown>) {}
    startup = mocks.producerStartup;
    shutdown = mocks.producerShutdown;
    send = mocks.producerSend;
  },
  PushConsumer: class {
    constructor(options: Record<string, unknown>) {
      mocks.consumerOptions = options;
      mocks.consumerInstance = this;
    }
    startup = mocks.consumerStartup;
    shutdown = mocks.consumerShutdown;
    requestTimeoutValue = 3000;
    wrapForwardMessageToDeadLetterQueueRequest = vi.fn(() => ({}));
    forwardMessageToDeadLetterQueueViaRpc = mocks.consumerForward;
  },
}));

import { DEFAULT_ROCKERMQ_CONFIG } from "../src/config.js";
import {
  computeStartupRetryDelay,
  getStats,
  publishMessage,
  startRockermqServer,
  stopRockermqServer,
} from "../src/transport/server.js";

const config = {
  ...DEFAULT_ROCKERMQ_CONFIG,
  connection: {
    ...DEFAULT_ROCKERMQ_CONFIG.connection,
    startupAttempts: 1,
    retryDelayMs: 0,
  },
};

describe("rocketmq transport reliability", () => {
  beforeEach(() => {
    mocks.producerStartup.mockReset().mockResolvedValue(undefined);
    mocks.producerShutdown.mockReset().mockResolvedValue(undefined);
    mocks.producerSend
      .mockReset()
      .mockResolvedValue({ messageId: "message-1" });
    mocks.consumerStartup.mockReset().mockResolvedValue(undefined);
    mocks.consumerShutdown.mockReset().mockResolvedValue(undefined);
    mocks.consumerForward.mockReset().mockResolvedValue({
      getStatus: () => ({ toObject: () => ({ code: 20_000 }) }),
    });
    mocks.consumerOptions = undefined;
    mocks.consumerInstance = undefined;
  });

  afterEach(async () => {
    await stopRockermqServer();
  });

  it("rolls back a producer when consumer startup fails", async () => {
    mocks.consumerStartup.mockRejectedValueOnce(
      new Error("consumer startup failed"),
    );

    await expect(
      startRockermqServer(config, async () => ({ ok: true })),
    ).rejects.toThrow("consumer startup failed");
    expect(mocks.consumerShutdown).toHaveBeenCalledOnce();
    expect(mocks.producerShutdown).toHaveBeenCalledOnce();
    expect(getStats().connected).toBe(false);
    await expect(
      publishMessage({ topic: "test", payload: "message" }),
    ).rejects.toThrow("RocketMQ endpoints not available");
  });

  it("maps transient failures to broker re-consume and successful work to ACK", async () => {
    const handler = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reconsume: true,
        reason: "temporary",
      })
      .mockResolvedValueOnce({ ok: true });
    await startRockermqServer(config, handler);

    expect(mocks.consumerInstance?.getRetryPolicy?.()).toMatchObject({
      maxAttempts: 17,
      initialDelayMs: 1000,
      maxDelayMs: 60_000,
      multiplier: 2,
    });

    const listener = mocks.consumerOptions?.messageListener as {
      consume: (message: Record<string, unknown>) => Promise<string>;
    };
    const message = {
      topic: "openclaw--agent--main--in--peer",
      body: Buffer.from("hello"),
      messageId: "message-1",
      deliveryAttempt: 1,
    };

    await expect(listener.consume(message)).resolves.toBe("FAILURE");
    await expect(
      listener.consume({ ...message, deliveryAttempt: 2 }),
    ).resolves.toBe("SUCCESS");
    expect(getStats()).toMatchObject({
      messagesReceived: 2,
      messagesAcked: 1,
      messagesNacked: 1,
      messagesRequeued: 1,
      inFlight: 0,
    });
  });

  it("rejects a second start while the transport is active", async () => {
    await startRockermqServer(config, async () => ({ ok: true }));
    await expect(
      startRockermqServer(config, async () => ({ ok: true })),
    ).rejects.toThrow("already started or starting");
  });

  it("interrupts startup retry backoff when the account is aborted", async () => {
    mocks.producerStartup.mockRejectedValue(new Error("proxy unavailable"));
    const controller = new AbortController();
    const retryingConfig = {
      ...config,
      connection: {
        ...config.connection,
        startupAttempts: 6,
        retryDelayMs: 60_000,
        retryMaxDelayMs: 60_000,
      },
    };

    const started = startRockermqServer(
      retryingConfig,
      async () => ({ ok: true }),
      controller.signal,
    );
    await vi.waitFor(() =>
      expect(mocks.producerStartup).toHaveBeenCalledOnce(),
    );
    controller.abort();

    await expect(started).resolves.toBeUndefined();
    expect(getStats().connected).toBe(false);
    expect(mocks.producerStartup).toHaveBeenCalledOnce();
  });

  it("forwards exhausted non-FIFO failures to DLQ before ACKing the source", async () => {
    const oneAttemptConfig = {
      ...config,
      consumer: {
        ...config.consumer,
        retry: { ...config.consumer.retry, maxAttempts: 1 },
      },
    };
    await startRockermqServer(oneAttemptConfig, async () => ({
      ok: false,
      reconsume: true,
      reason: "permanent",
    }));
    const listener = mocks.consumerOptions?.messageListener as {
      consume: (message: Record<string, unknown>) => Promise<string>;
    };

    await expect(
      listener.consume({
        topic: "openclaw--agent--main--in--peer",
        body: Buffer.from("poison"),
        messageId: "poison-1",
        deliveryAttempt: 1,
        endpoints: {},
      }),
    ).resolves.toBe("SUCCESS");

    expect(mocks.consumerForward).toHaveBeenCalledOnce();
    expect(getStats()).toMatchObject({ messagesDeadLettered: 1 });
  });

  it("routes thrown handler errors through the same retry/DLQ state machine", async () => {
    const oneAttemptConfig = {
      ...config,
      consumer: {
        ...config.consumer,
        retry: { ...config.consumer.retry, maxAttempts: 1 },
      },
    };
    await startRockermqServer(oneAttemptConfig, async () => {
      throw new Error("poison handler");
    });
    const listener = mocks.consumerOptions?.messageListener as {
      consume: (message: Record<string, unknown>) => Promise<string>;
    };

    await expect(
      listener.consume({
        topic: "openclaw--agent--main--in--peer",
        body: Buffer.from("poison"),
        messageId: "poison-thrown-1",
        deliveryAttempt: 1,
        endpoints: {},
      }),
    ).resolves.toBe("SUCCESS");

    expect(mocks.consumerForward).toHaveBeenCalledOnce();
    expect(getStats()).toMatchObject({ inFlight: 0 });
  });

  it("ACKs permanent drops without counting them as broker NACKs", async () => {
    await startRockermqServer(config, async () => ({
      ok: false,
      reconsume: false,
      reason: "no_route_matched",
    }));
    const listener = mocks.consumerOptions?.messageListener as {
      consume: (message: Record<string, unknown>) => Promise<string>;
    };
    const before = getStats();

    await expect(
      listener.consume({
        topic: "unknown",
        body: Buffer.from("drop"),
        messageId: "drop-1",
      }),
    ).resolves.toBe("SUCCESS");

    const after = getStats();
    expect(after.messagesAcked - before.messagesAcked).toBe(1);
    expect(after.messagesNacked - before.messagesNacked).toBe(0);
    expect(after.messagesRequeued - before.messagesRequeued).toBe(0);
  });

  it("records handler exceptions as ACKed drops when re-consume is disabled", async () => {
    const noRetryConfig = {
      ...config,
      consumer: { ...config.consumer, reconsumeOnError: false },
    };
    await startRockermqServer(noRetryConfig, async () => {
      throw new Error("bad handler");
    });
    const listener = mocks.consumerOptions?.messageListener as {
      consume: (message: Record<string, unknown>) => Promise<string>;
    };
    const before = getStats();

    await expect(
      listener.consume({
        topic: "topic",
        body: Buffer.from("drop"),
        messageId: "drop-2",
      }),
    ).resolves.toBe("SUCCESS");

    const after = getStats();
    expect(after.messagesAcked - before.messagesAcked).toBe(1);
    expect(after.messagesDropped - before.messagesDropped).toBe(1);
    expect(after.messagesNacked - before.messagesNacked).toBe(0);
    expect(after.lastDropReason).toBe("inbound_handler_error");
  });

  it("uses capped exponential backoff with deterministic jitter", () => {
    expect(computeStartupRetryDelay(1000, 5000, 0.2, 1, () => 0.5)).toBe(1000);
    expect(computeStartupRetryDelay(1000, 5000, 0.2, 2, () => 0.5)).toBe(2000);
    expect(computeStartupRetryDelay(1000, 5000, 0.2, 4, () => 0.5)).toBe(5000);
    expect(computeStartupRetryDelay(1000, 5000, 0.2, 1, () => 0)).toBe(800);
    expect(computeStartupRetryDelay(1000, 5000, 0.2, 1, () => 1)).toBe(1200);
  });

  it("rejects oversized outbound payloads before creating a producer", async () => {
    await expect(
      publishMessage({
        topic: "test",
        payload: "12345",
        endpoints: "127.0.0.1:8081",
        maxMessageSizeInBytes: 4,
      }),
    ).rejects.toThrow("payload exceeds producer.maxMessageSizeInBytes");
    expect(mocks.producerStartup).not.toHaveBeenCalled();
  });

  it("bounds shutdown waiting and still attempts to close both clients", async () => {
    const fastShutdownConfig = {
      ...config,
      connection: {
        ...config.connection,
        shutdownTimeoutMs: 5,
      },
    };
    await startRockermqServer(fastShutdownConfig, async () => ({ ok: true }));
    mocks.consumerShutdown.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    await expect(stopRockermqServer()).resolves.toBeUndefined();
    expect(mocks.consumerShutdown).toHaveBeenCalledOnce();
    expect(mocks.producerShutdown).toHaveBeenCalledOnce();
    expect(getStats().lastError).toContain("consumer shutdown timed out");
  });
});

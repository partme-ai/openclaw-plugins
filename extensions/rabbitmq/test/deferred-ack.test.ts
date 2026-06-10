/**
 * Deferred ack-after-reply integration tests (inbound + message-sdk helper).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as bridge from "@partme.ai/openclaw-message-sdk/bridge";
import { DEFAULT_RABBITMQ_CONFIG } from "../src/config.js";
import type { InboundEvent } from "../src/transport/server.js";

const publishMessage = vi.fn(async () => undefined);

vi.mock("../src/transport/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/transport/server.js")>();
  return {
    ...actual,
    publishMessage,
  };
});

vi.mock("../src/runtime.js", () => ({
  getRabbitmqRuntime: () => ({
    config: {},
    channel: {
      routing: {
        resolveAgentRoute: vi.fn(async () => ({ agentId: "agent-1", sessionKey: "sk-1" })),
      },
    },
  }),
}));

function mockDelivery() {
  let settled = false;
  return {
    get settled() {
      return settled;
    },
    ack: vi.fn(() => {
      settled = true;
    }),
    nack: vi.fn((options?: { requeue?: boolean; reason?: string }) => {
      settled = true;
      void options;
    }),
  };
}

function buildEvent(routingKey: string, delivery = mockDelivery()): InboundEvent {
  return {
    routingKey,
    content: Buffer.from(JSON.stringify({ text: "hello" })),
    properties: { correlationId: "cid-1" },
    fields: { routingKey, exchange: "ex", deliveryTag: 1, redelivered: false, consumerTag: "c" },
    delivery,
  };
}

describe("rabbitmq deferred ack inbound", () => {
  let dispatchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(bridge, "resolveChannelDispatchIdentity").mockResolvedValue({
      agentId: "agent-1",
      sessionKey: "rabbitmq:default:agent-1:device-1",
    });
    dispatchSpy = vi.spyOn(bridge, "dispatchChannelMessage").mockImplementation(async (params) => {
      await params.reply.deliver({ wire: '{"text":"reply"}', runId: "run-1" });
      return { mode: "reply-pipeline" as const, wireResult: { ctx: {}, replyOptions: {} } };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not ack on receive; acks after reply publish succeeds", async () => {
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = {
      ...DEFAULT_RABBITMQ_CONFIG,
      subscribeTopics: [],
      topicBindings: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } },
    };

    const result = await processInbound(
      buildEvent("openclaw.agent.agent-1.in.device-1", delivery),
      config,
    );

    expect(result.accepted).toBe(true);
    expect(result.manualAck).toBe(true);
    expect(publishMessage).toHaveBeenCalledTimes(1);
    expect(delivery.ack).toHaveBeenCalledTimes(1);
    expect(delivery.nack).not.toHaveBeenCalled();
  });

  it("nacks when reply publish fails", async () => {
    publishMessage.mockRejectedValueOnce(new Error("publish failed"));
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = {
      ...DEFAULT_RABBITMQ_CONFIG,
      subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } },
    };

    const result = await processInbound(
      buildEvent("openclaw.agent.agent-1.in.device-1", delivery),
      config,
    );

    expect(result.accepted).toBe(false);
    expect(delivery.nack).toHaveBeenCalled();
    expect(delivery.ack).not.toHaveBeenCalled();
  });

  it("nacks when reply required but dispatch produces no deliver", async () => {
    dispatchSpy.mockImplementationOnce(async () => ({
      mode: "reply-pipeline" as const,
      wireResult: { ctx: {}, replyOptions: {} },
    }));
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = {
      ...DEFAULT_RABBITMQ_CONFIG,
      subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } },
    };

    await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);

    expect(publishMessage).not.toHaveBeenCalled();
    expect(delivery.nack).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "no_reply_published" }),
    );
  });
});

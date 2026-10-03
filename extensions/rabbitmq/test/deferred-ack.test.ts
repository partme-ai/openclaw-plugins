/**
 * Deferred ack-after-reply integration tests (inbound + message-sdk helper).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as bridge from "@partme.ai/openclaw-message-sdk/bridge";
import { DEFAULT_RABBITMQ_CONFIG } from "../src/config.js";
import type { InboundEvent } from "../src/transport/server.js";
import { getRabbitmqClaimableDedupe } from "../src/shared/wire-helpers.js";

const publishMessage = vi.fn(async () => undefined);
const publishAmbiguousInbound = vi.fn(async () => undefined);

vi.mock("../src/transport/server.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/transport/server.js")>();
  return {
    ...actual,
    publishMessage,
    publishAmbiguousInbound,
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

let eventSequence = 0;

function buildEvent(routingKey: string, delivery = mockDelivery()): InboundEvent {
  return {
    routingKey,
    content: Buffer.from(JSON.stringify({ text: "hello" })),
    properties: { correlationId: `cid-${++eventSequence}` },
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
      return { mode: "reply-pipeline" as const, wireResult: { ctx: {}, replyOptions: {} }, deliveryOutcome: { kind: "delivered" } };
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

  it("commits the durable outcome only after broker ACK", async () => {
    const confirmDelivery = vi.fn();
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "reply" });
      return { mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} },
        deliveryOutcome: { kind: "delivered" }, confirmDelivery };
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(confirmDelivery).toHaveBeenCalledOnce();
    expect(delivery.ack.mock.invocationCallOrder[0]).toBeLessThan(confirmDelivery.mock.invocationCallOrder[0]);
  });

  it("surfaces SQLite confirmation failure after ACK without reporting a second broker disposition", async () => {
    const confirmDelivery = vi.fn(() => { throw new Error("SQLite confirmation failed"); });
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "reply" });
      return { mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} },
        deliveryOutcome: { kind: "delivered" }, confirmDelivery };
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const nack = delivery.nack;
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    const result = await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(result.accepted).toBe(false);
    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(confirmDelivery).toHaveBeenCalledOnce();
    expect(nack).not.toHaveBeenCalled();
  });

  it("ACKs a prepared duplicate and confirms its durable outcome without publishing a second reply", async () => {
    const confirmDelivery = vi.fn();
    dispatchSpy.mockResolvedValueOnce({ mode: "reply-pipeline", wireResult: { ctx: { skippedDuplicate: true }, replyOptions: {} },
      deliveryOutcome: { kind: "delivered" }, confirmDelivery });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    const result = await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(result.accepted).toBe(true);
    expect(delivery.ack).toHaveBeenCalledOnce();
    expect(confirmDelivery).toHaveBeenCalledOnce();
    expect(publishMessage).not.toHaveBeenCalled();
    expect(delivery.ack.mock.invocationCallOrder[0]).toBeLessThan(confirmDelivery.mock.invocationCallOrder[0]);
  });

  it("requeues a prepared outcome when ACK throws before confirmation", async () => {
    const confirmDelivery = vi.fn();
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "reply" });
      return { mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} },
        deliveryOutcome: { kind: "delivered" }, confirmDelivery };
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    delivery.ack.mockImplementationOnce(() => { throw new Error("ACK failed"); });
    const nack = delivery.nack;
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    const result = await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(result.accepted).toBe(false);
    expect(nack).toHaveBeenCalledWith(expect.objectContaining({ requeue: true }));
    expect(confirmDelivery).not.toHaveBeenCalled();
    expect(publishAmbiguousInbound).not.toHaveBeenCalled();
  });

  it("keeps every NACK requeued when prepared ACK and the first NACK both throw under the default policy", async () => {
    const confirmDelivery = vi.fn();
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "reply" });
      return { mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} },
        deliveryOutcome: { kind: "delivered" }, confirmDelivery };
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    delivery.ack.mockImplementationOnce(() => { throw new Error("ACK failed"); });
    delivery.nack.mockImplementationOnce(() => { throw new Error("first NACK failed"); });
    const nack = delivery.nack;
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    expect(config.consume.requeueOnError).toBe(false);
    const result = await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(result.accepted).toBe(false);
    expect(nack).toHaveBeenCalledTimes(2);
    for (const [options] of nack.mock.calls) expect(options).toEqual(expect.objectContaining({ requeue: true }));
    expect(confirmDelivery).not.toHaveBeenCalled();
    expect(publishAmbiguousInbound).not.toHaveBeenCalled();
  });

  it("keeps the requeue guard on the delivery handle after repeated NACK failures", async () => {
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "reply" });
      return { mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} },
        deliveryOutcome: { kind: "delivered" }, confirmDelivery: vi.fn() };
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    delivery.ack.mockImplementationOnce(() => { throw new Error("ACK failed"); });
    delivery.nack.mockImplementationOnce(() => { throw new Error("first NACK failed"); })
      .mockImplementationOnce(() => { throw new Error("second NACK failed"); });
    const nack = delivery.nack;
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    await expect(processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config)).rejects.toThrow("second NACK failed");
    expect(delivery.settled).toBe(false);
    delivery.nack({ requeue: false, reason: "later_transport_fallback" });
    expect(nack).toHaveBeenCalledTimes(3);
    for (const [options] of nack.mock.calls) expect(options).toEqual(expect.objectContaining({ requeue: true }));
  });

  it("confirms to DLQ before NACK when receipt reports delivery but reply publisher was never called", async () => {
    const confirmDelivery = vi.fn();
    dispatchSpy.mockResolvedValueOnce({ mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} },
      deliveryOutcome: { kind: "delivered" }, confirmDelivery });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(publishAmbiguousInbound).toHaveBeenCalledOnce();
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({ requeue: false }));
    expect(delivery.ack).not.toHaveBeenCalled();
    expect(confirmDelivery).not.toHaveBeenCalled();
    expect(publishAmbiguousInbound.mock.invocationCallOrder[0]).toBeLessThan(delivery.nack.mock.invocationCallOrder[0]);
  });

  it("does not commit or ack when a block publishes but final delivery is ambiguous", async () => {
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "block" });
      return { mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} }, deliveryOutcome: { kind: "ambiguous" } };
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    const event = buildEvent("openclaw.agent.agent-1.in.device-1", delivery);
    const result = await processInbound(event, config);
    expect(result.accepted).toBe(false);
    expect(delivery.ack).not.toHaveBeenCalled();
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({ requeue: false, reason: "ambiguous_delivery" }));
    expect(publishAmbiguousInbound).toHaveBeenCalledOnce();
    expect(await getRabbitmqClaimableDedupe(config.idempotency)?.hasRecent(event.properties.correlationId!)).toBe(false);
  });

  it("quarantines an exception after a visible block instead of requeuing the whole turn", async () => {
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "block" });
      throw new Error("final failed");
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    expect((await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config)).accepted).toBe(false);
    expect(publishAmbiguousInbound).toHaveBeenCalledOnce();
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({ requeue: false }));
  });

  it("quarantines a replay whose durable journal is pending", async () => {
    dispatchSpy.mockRejectedValueOnce(new bridge.PendingDeliveryReconciliationError("rabbitmq", "default", "cid-pending"));
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    expect((await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config)).accepted).toBe(false);
    expect(publishAmbiguousInbound).toHaveBeenCalledOnce();
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({ requeue: false }));
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("does not ACK an inflight duplicate before durable settlement", async () => {
    let finishFirst!: () => void;
    dispatchSpy.mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = () => resolve({ mode: "reply-pipeline", wireResult: { ctx: {}, replyOptions: {} }, deliveryOutcome: { kind: "delivered" } });
    }));
    dispatchSpy.mockRejectedValueOnce(new bridge.PendingDeliveryReconciliationError("rabbitmq", "default", "cid-inflight"));
    const { processInbound } = await import("../src/inbound.js");
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    const first = buildEvent("openclaw.agent.agent-1.in.device-1");
    first.properties.correlationId = "cid-inflight";
    const firstTask = processInbound(first, config);
    await vi.waitFor(() => expect(dispatchSpy).toHaveBeenCalledTimes(1));

    const duplicate = { ...first, delivery: mockDelivery() };
    await processInbound(duplicate, config);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(duplicate.delivery.ack).not.toHaveBeenCalled();
    finishFirst();
    await firstTask;
  });

  it("requeues an ambiguous delivery when its confirmed DLQ publish fails", async () => {
    dispatchSpy.mockRejectedValueOnce(new bridge.PendingDeliveryReconciliationError("rabbitmq", "default", "cid-pending"));
    publishAmbiguousInbound.mockRejectedValueOnce(new Error("DLQ confirm failed"));
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };

    await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);

    expect(delivery.ack).not.toHaveBeenCalled();
    expect(delivery.nack).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requeue: true }));
    expect(publishMessage).not.toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it("retains broker custody after a visible reply if its confirmed DLQ publish fails", async () => {
    dispatchSpy.mockImplementationOnce(async (params) => {
      await params.reply.deliver({ wire: "visible block" });
      throw new Error("dispatch failed after reply");
    });
    publishAmbiguousInbound.mockRejectedValueOnce(new Error("DLQ confirm failed"));
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };

    await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);

    expect(publishMessage).toHaveBeenCalledTimes(1);
    expect(delivery.ack).not.toHaveBeenCalled();
    expect(delivery.nack).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requeue: true }));
  });

  it("requeues an inbound without identity if its confirmed DLQ publish fails", async () => {
    publishAmbiguousInbound.mockRejectedValueOnce(new Error("DLQ confirm failed"));
    const { processInbound } = await import("../src/inbound.js");
    const event = buildEvent("openclaw.agent.agent-1.in.device-1");
    event.properties.correlationId = undefined;
    event.properties.messageId = undefined;
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };

    await processInbound(event, config);

    expect(event.delivery.ack).not.toHaveBeenCalled();
    expect(event.delivery.nack).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ requeue: true }));
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("quarantines a pending subagent run without requeuing it for another Agent turn", async () => {
    dispatchSpy.mockResolvedValueOnce({ mode: "subagent", runId: "run-pending", delivered: false,
      outcome: { kind: "pending" }, deliveryOutcome: { kind: "ambiguous" } });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "subagent" as const, reply: { enabled: true } } };
    expect((await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config)).accepted).toBe(false);
    expect(publishAmbiguousInbound).toHaveBeenCalledOnce();
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({ requeue: false }));
  });
  it("confirms a timed-out Agent turn to the DLQ before NACK when the journal is pending", async () => {
    dispatchSpy.mockResolvedValueOnce({ mode: "subagent", runId: "run-timeout", delivered: false,
      outcome: { kind: "failed", status: "timeout" }, deliveryOutcome: { kind: "ambiguous" } });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "subagent" as const, reply: { enabled: true } } };
    await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(publishAmbiguousInbound).toHaveBeenCalledOnce();
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({ requeue: false }));
    expect(publishAmbiguousInbound.mock.invocationCallOrder[0]).toBeLessThan(delivery.nack.mock.invocationCallOrder[0]);
  });

  it("rejects a reply-required inbound without stable broker identity before Agent dispatch", async () => {
    const { processInbound } = await import("../src/inbound.js");
    const event = buildEvent("openclaw.agent.agent-1.in.device-1");
    event.properties.correlationId = undefined;
    event.properties.messageId = undefined;
    const config = { ...DEFAULT_RABBITMQ_CONFIG, subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } } };
    expect((await processInbound(event, config)).accepted).toBe(false);
    expect(dispatchSpy).not.toHaveBeenCalled();
    expect(event.delivery.ack).not.toHaveBeenCalled();
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

  it("nacks and releases a before-send failure so it can retry", async () => {
    dispatchSpy.mockImplementationOnce(async () => ({
      mode: "reply-pipeline" as const,
      wireResult: { ctx: {}, replyOptions: {} },
      deliveryOutcome: { kind: "retryable" },
    }));
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = {
      ...DEFAULT_RABBITMQ_CONFIG,
      subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "reply-pipeline" as const, reply: { enabled: true } },
    };

    const event = buildEvent("openclaw.agent.agent-1.in.device-1", delivery);
    const result = await processInbound(event, config);

    expect(result.accepted).toBe(false);
    expect(publishMessage).not.toHaveBeenCalled();
    expect(delivery.nack).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "retryable_delivery" }),
    );
    const retryDelivery = mockDelivery();
    await processInbound({ ...event, delivery: retryDelivery }, config);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });

  it("releases a timed-out subagent claim without publishing or acknowledging", async () => {
    dispatchSpy.mockResolvedValue({
      mode: "subagent", runId: "run-timeout", delivered: false,
      outcome: { kind: "failed", status: "timeout" },
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = {
      ...DEFAULT_RABBITMQ_CONFIG,
      subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "subagent" as const, reply: { enabled: true } },
    };
    const event = buildEvent("openclaw.agent.agent-1.in.device-1", delivery);

    expect((await processInbound(event, config)).accepted).toBe(false);
    expect(delivery.nack).toHaveBeenCalledTimes(1);
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({
      reason: "subagent_wait status=timeout runId=run-timeout",
    }));
    expect(delivery.ack).not.toHaveBeenCalled();
    expect(publishMessage).not.toHaveBeenCalled();
    await processInbound({ ...event, delivery: mockDelivery() }, config);
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });

  it.each(["error", "invalid"] as const)("retains %s subagent status without exposing a reply", async (status) => {
    dispatchSpy.mockResolvedValue({
      mode: "subagent", runId: `run-${status}`, delivered: false,
      outcome: { kind: "failed", status },
    });
    const { processInbound } = await import("../src/inbound.js");
    const delivery = mockDelivery();
    const config = {
      ...DEFAULT_RABBITMQ_CONFIG,
      subscribeTopics: [],
      dispatch: { ...DEFAULT_RABBITMQ_CONFIG.dispatch, mode: "subagent" as const, reply: { enabled: true } },
    };
    const result = await processInbound(buildEvent("openclaw.agent.agent-1.in.device-1", delivery), config);
    expect(result.accepted).toBe(false);
    expect(delivery.nack).toHaveBeenCalledWith(expect.objectContaining({
      reason: `subagent_wait status=${status} runId=run-${status}`,
    }));
    expect(delivery.ack).not.toHaveBeenCalled();
    expect(publishMessage).not.toHaveBeenCalled();
  });
});

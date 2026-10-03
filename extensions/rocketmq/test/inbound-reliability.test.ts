import { beforeEach, describe, expect, it, vi } from "vitest";

const { dispatchChannelMessage, normalizeWireIngress } = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn(),
  normalizeWireIngress: vi.fn(),
}));

vi.mock("@partme.ai/openclaw-message-sdk/bridge", async (importOriginal) => ({
  ...await importOriginal<typeof import("@partme.ai/openclaw-message-sdk/bridge")>(),
  normalizeWireIngress,
  resolveChannelDispatchIdentity: vi.fn(async () => ({
    agentId: "main",
    sessionKey: "agent:main:rocketmq:direct:peer",
  })),
  dispatchChannelMessage,
}));

import { DEFAULT_ROCKERMQ_CONFIG } from "../src/config.js";
import { processInbound } from "../src/inbound.js";
import { setRockermqRuntime } from "../src/runtime.js";

describe("rocketmq inbound reliability", () => {
  beforeEach(() => {
    dispatchChannelMessage.mockReset().mockResolvedValue({ deliveryOutcome: { kind: "delivered" } });
    normalizeWireIngress.mockReset().mockReturnValue({
      accepted: true,
      text: "hello",
      unified: { content: "hello" },
    });
    setRockermqRuntime({ config: {} });
  });

  it("retries a pre-send failure and passes the stable message ID to SDK custody", async () => {
    const messageId = `retry-${Date.now()}-${Math.random()}`;
    const event = {
      topic: "openclaw--agent--main--in--peer",
      body: Buffer.from("hello"),
      messageId,
    };

    dispatchChannelMessage.mockRejectedValueOnce(new Error("temporary failure"));
    const failed = await processInbound(event, DEFAULT_ROCKERMQ_CONFIG);
    expect(failed).toMatchObject({ accepted: false, reconsume: true });

    dispatchChannelMessage.mockResolvedValueOnce({ deliveryOutcome: { kind: "delivered" } });
    const redelivered = await processInbound(event, DEFAULT_ROCKERMQ_CONFIG);
    expect(redelivered).toMatchObject({ accepted: true, routeSource: "standard" });
    expect(dispatchChannelMessage.mock.calls[1][0]).toMatchObject({
      deliveryIdentity: messageId,
      requireDeliveryIdentity: true,
    });

    const duplicate = await processInbound(event, DEFAULT_ROCKERMQ_CONFIG);
    expect(duplicate).toEqual({ accepted: true, routeSource: "standard" });
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(3);
  });

  it("fails closed when reply dispatch has no stable broker or envelope ID", async () => {
    const result = await processInbound({
      topic: "openclaw--agent--main--in--peer",
      body: Buffer.from("hello"),
    }, DEFAULT_ROCKERMQ_CONFIG);
    expect(result).toEqual({ accepted: false, reconsume: true, reason: "missing_delivery_identity" });
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("does not acknowledge ambiguous delivery", async () => {
    dispatchChannelMessage.mockResolvedValueOnce({ deliveryOutcome: { kind: "ambiguous" } });
    const result = await processInbound({
      topic: "openclaw--agent--main--in--peer",
      body: Buffer.from("hello"),
      messageId: "ambiguous-delivery",
    }, DEFAULT_ROCKERMQ_CONFIG);
    expect(result).toMatchObject({ accepted: false, reconsume: true });
  });

  it("requests broker redelivery when the OpenClaw runtime is unavailable", async () => {
    setRockermqRuntime(null);
    const result = await processInbound(
      {
        topic: "openclaw--agent--main--in--peer",
        body: Buffer.from("hello"),
        messageId: `runtime-${Date.now()}`,
      },
      DEFAULT_ROCKERMQ_CONFIG,
    );
    expect(result).toEqual({
      accepted: false,
      reconsume: true,
      reason: "runtime_not_initialized",
    });
  });

  it("deduplicates using the wire envelope idempotency key", async () => {
    const idempotencyKey = `wire-${Date.now()}-${Math.random()}`;
    normalizeWireIngress.mockReturnValue({
      accepted: true,
      text: "hello",
      unified: null,
      idempotencyKey,
    });
    dispatchChannelMessage.mockResolvedValue({ deliveryOutcome: { kind: "delivered" } });
    const event = {
      topic: "openclaw--agent--main--in--peer",
      body: Buffer.from("hello"),
    };

    await expect(processInbound(event, DEFAULT_ROCKERMQ_CONFIG)).resolves.toMatchObject({
      accepted: true,
      routeSource: "standard",
    });
    await expect(processInbound(event, DEFAULT_ROCKERMQ_CONFIG)).resolves.toEqual({
      accepted: true,
      routeSource: "standard",
    });
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(2);
  });

  it("drops an empty parsed payload without dispatching it", async () => {
    normalizeWireIngress.mockReturnValue({ accepted: true, text: "  ", unified: null });

    await expect(processInbound({
      topic: "openclaw--agent--main--in--peer",
      body: Buffer.from("{}"),
    }, DEFAULT_ROCKERMQ_CONFIG)).resolves.toEqual({
      accepted: false,
      reason: "empty_payload",
    });
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });
});

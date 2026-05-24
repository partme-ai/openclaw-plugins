/**
 * STOMP inbound dispatch 单元测试（mock bridge + transport）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn().mockResolvedValue(undefined),
  resolveChannelDispatchIdentity: vi.fn().mockResolvedValue({
    agentId: "iot-agent",
    sessionKey: "agent:iot-agent:stomp-tcp:direct:peer-1",
  }),
  publishToDestination: vi.fn(),
}));

vi.mock("@partme.ai/openclaw-message-sdk/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@partme.ai/openclaw-message-sdk/bridge")>();
  return {
    ...actual,
    dispatchChannelMessage: mocks.dispatchChannelMessage,
    resolveChannelDispatchIdentity: mocks.resolveChannelDispatchIdentity,
  };
});

vi.mock("../src/transport/server.js", () => ({
  publishToDestination: mocks.publishToDestination,
}));

import { dispatchInboundMessage } from "../src/inbound.js";
import { clearStompRuntime, setStompRuntime } from "../src/runtime.js";
import type { InboundMessage } from "../src/types.js";

const { dispatchChannelMessage, resolveChannelDispatchIdentity, publishToDestination } = mocks;

function makeMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    agentId: "iot-agent",
    accountId: "default",
    peerId: "peer-1",
    destination: "/topic/devices/alpha/in",
    replyDestination: "/topic/devices/reply",
    rawPayload: "hello stomp",
    ...overrides,
  };
}

function makeRuntime() {
  return {
    config: {},
    channel: {
      routing: { resolveAgentRoute: vi.fn() },
      reply: {
        finalizeInboundContext: vi.fn(),
        createReplyDispatcherWithTyping: vi.fn(),
        dispatchReplyFromConfig: vi.fn(),
      },
    },
  };
}

describe("dispatchInboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearStompRuntime();
    setStompRuntime(makeRuntime());
  });

  it("dispatches plain payload via dispatchChannelMessage", async () => {
    await dispatchInboundMessage(makeMessage());

    expect(resolveChannelDispatchIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: "stomp-tcp",
        peerId: "peer-1",
        agentId: "iot-agent",
      }),
    );
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
    expect(dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      mode: "reply-pipeline",
      channel: "stomp-tcp",
      text: "hello stomp",
      reply: expect.objectContaining({ outboundFormat: "envelope" }),
    });
  });

  it("reply deliver publishes wire to reply destination", async () => {
    await dispatchInboundMessage(makeMessage());

    const reply = dispatchChannelMessage.mock.calls[0][0].reply as {
      deliver: (p: { wire: string }) => Promise<void>;
    };
    await reply.deliver({ wire: '{"text":"reply"}' });
    expect(publishToDestination).toHaveBeenCalledWith("/topic/devices/reply", '{"text":"reply"}');
  });

  it("falls back reply destination when omitted", async () => {
    await dispatchInboundMessage(makeMessage({ replyDestination: undefined }));

    const reply = dispatchChannelMessage.mock.calls[0][0].reply as {
      replyRoute: { destination: string };
    };
    expect(reply.replyRoute.destination).toBe("/topic/session.peer-1");
  });

  it("drops duplicate idempotency keys", async () => {
    const key = `stomp-dedup-${Date.now()}`;
    await dispatchInboundMessage(makeMessage({ idempotencyKey: key, rawPayload: "once" }));
    await dispatchInboundMessage(makeMessage({ idempotencyKey: key, rawPayload: "once" }));

    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("parses jsonTextOrPlain envelope payloads", async () => {
    await dispatchInboundMessage(
      makeMessage({ rawPayload: JSON.stringify({ text: "from json" }) }),
    );

    expect(dispatchChannelMessage.mock.calls[0][0].text).toBe("from json");
  });

  it("throws when runtime is not initialized", async () => {
    clearStompRuntime();

    await expect(dispatchInboundMessage(makeMessage())).rejects.toThrow(/runtime is not initialized/);
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });
});

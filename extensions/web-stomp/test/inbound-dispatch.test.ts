/**
 * Web STOMP inbound dispatch 单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn().mockResolvedValue({ deliveryOutcome: { kind: "delivered" } }),
  resolveChannelDispatchIdentity: vi.fn().mockResolvedValue({
    agentId: "main",
    sessionKey: "agent:main:stomp:direct:peer-1",
  }),
  publishToDestination: vi.fn().mockReturnValue(1),
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

import { dispatchInboundStomp } from "../src/inbound.js";
import { setWebStompRuntime } from "../src/runtime.js";

const { dispatchChannelMessage, resolveChannelDispatchIdentity, publishToDestination } = mocks;

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

describe("dispatchInboundStomp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishToDestination.mockReturnValue(1);
    setWebStompRuntime(makeRuntime());
  });

  it("dispatches payload through dispatchChannelMessage", async () => {
    await dispatchInboundStomp({
      peerId: "peer-1",
      destination: "/queue/agent.demo",
      rawPayload: "hello web-stomp",
      idempotencyKey: "test-hello",
    });

    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
    expect(dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      channel: "stomp",
      peerId: "peer-1",
      text: "hello web-stomp",
    });
  });

  it("reply deliver publishes to session destination", async () => {
    await dispatchInboundStomp({
      peerId: "peer-2",
      destination: "/queue/in",
      rawPayload: "ping",
      idempotencyKey: `test-${Date.now()}-${Math.random()}`,
    });

    const reply = dispatchChannelMessage.mock.calls[0][0].reply as {
      deliver: (p: { wire: string }) => Promise<void>;
    };
    await reply.deliver({ wire: '{"text":"pong"}' });
    expect(publishToDestination).toHaveBeenCalledWith("/topic/session.peer-2", '{"text":"pong"}');
  });

  it("rejects the Agent turn when no subscriber accepts the reply", async () => {
    publishToDestination.mockReturnValue(0);
    await dispatchInboundStomp({
      peerId: "peer-no-subscriber",
      destination: "/queue/in",
      rawPayload: "ping",
      idempotencyKey: `test-${Date.now()}-${Math.random()}`,
    });

    const reply = dispatchChannelMessage.mock.calls[0][0].reply as {
      deliver: (p: { wire: string }) => Promise<void>;
    };
    await expect(reply.deliver({ wire: "reply" })).rejects.toThrow(/No Web STOMP subscriber/);
  });

  it("passes duplicate IDs to durable SDK reconciliation", async () => {
    const key = `web-stomp-dedup-${Date.now()}`;
    await dispatchInboundStomp({
      peerId: "peer-3",
      destination: "/queue/in",
      rawPayload: "once",
      idempotencyKey: key,
    });
    await dispatchInboundStomp({
      peerId: "peer-3",
      destination: "/queue/in",
      rawPayload: "once",
      idempotencyKey: key,
    });

    expect(dispatchChannelMessage).toHaveBeenCalledTimes(2);
  });

  it("keeps a SEND without message-id on the best-effort path", async () => {
    await dispatchInboundStomp({ peerId: "peer-1", destination: "/queue/in", rawPayload: "ping" });
    expect(dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      deliveryIdentity: undefined,
      requireDeliveryIdentity: false,
    });
  });

  it("scopes a caller ID to its authenticated sender across reconnects", async () => {
    const common = { destination: "/queue/in", rawPayload: "ping", idempotencyKey: "same" };
    await dispatchInboundStomp({ ...common, senderScope: "user:alice", peerId: "conn-1" });
    await dispatchInboundStomp({ ...common, senderScope: "user:alice", peerId: "conn-2" });
    await dispatchInboundStomp({ ...common, senderScope: "user:bob", peerId: "conn-3" });
    const ids = dispatchChannelMessage.mock.calls.map(([args]) => args.deliveryIdentity);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    const contexts = dispatchChannelMessage.mock.calls.map(([args]) => args.deliveryFingerprintContext);
    expect(contexts[0]).toEqual(contexts[1]);
    expect(contexts[2]).not.toEqual(contexts[0]);
  });

  it("releases an idempotency claim after Agent dispatch fails", async () => {
    const key = `web-stomp-retry-${Date.now()}`;
    dispatchChannelMessage.mockRejectedValueOnce(new Error("temporary Agent failure"));
    const message = {
      peerId: "peer-retry",
      destination: "/queue/in",
      rawPayload: "retry me",
      idempotencyKey: key,
    };

    await expect(dispatchInboundStomp(message)).rejects.toThrow("temporary Agent failure");
    await dispatchInboundStomp(message);
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(2);
  });

  it("rejects empty payloads", async () => {
    await expect(dispatchInboundStomp({
      peerId: "peer-empty",
      destination: "/queue/in",
      rawPayload: "   ",
    })).rejects.toThrow(/payload is empty/);
  });

  it("uses agentId hint when resolving identity", async () => {
    await dispatchInboundStomp({
      peerId: "peer-4",
      agentId: "sales",
      destination: "/queue/agent.sales",
      rawPayload: "lead",
      idempotencyKey: "test-lead",
    });

    expect(resolveChannelDispatchIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: "sales" }),
    );
  });

  it("throws when runtime is not initialized", async () => {
    setWebStompRuntime(null as never);
    await expect(
      dispatchInboundStomp({
        peerId: "peer-x",
        destination: "/queue/x",
        rawPayload: "x",
      }),
    ).rejects.toThrow(/runtime is not initialized/);
  });
});

/**
 * Web STOMP inbound dispatch 单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn().mockResolvedValue(undefined),
  resolveChannelDispatchIdentity: vi.fn().mockResolvedValue({
    agentId: "main",
    sessionKey: "agent:main:stomp:direct:peer-1",
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
    setWebStompRuntime(makeRuntime());
  });

  it("dispatches payload through dispatchChannelMessage", async () => {
    await dispatchInboundStomp({
      peerId: "peer-1",
      destination: "/queue/agent.demo",
      rawPayload: "hello web-stomp",
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
    });

    const reply = dispatchChannelMessage.mock.calls[0][0].reply as {
      deliver: (p: { wire: string }) => Promise<void>;
    };
    await reply.deliver({ wire: '{"text":"pong"}' });
    expect(publishToDestination).toHaveBeenCalledWith("/topic/session.peer-2", '{"text":"pong"}');
  });

  it("drops duplicate idempotency keys", async () => {
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

    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("uses agentId hint when resolving identity", async () => {
    await dispatchInboundStomp({
      peerId: "peer-4",
      agentId: "sales",
      destination: "/queue/agent.sales",
      rawPayload: "lead",
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

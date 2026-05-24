/**
 * Redis Stream handleInboundMessage 单元测试（mock bridge + publisher）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn().mockResolvedValue(undefined),
  resolveChannelDispatchIdentity: vi.fn().mockResolvedValue({
    agentId: "main",
    sessionKey: "agent:main:redis-stream:direct:openclaw:agent:demo:in",
  }),
  publishMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@partme.ai/openclaw-message-sdk/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@partme.ai/openclaw-message-sdk/bridge")>();
  return {
    ...actual,
    dispatchChannelMessage: mocks.dispatchChannelMessage,
    resolveChannelDispatchIdentity: mocks.resolveChannelDispatchIdentity,
  };
});

vi.mock("../src/transport/publisher.js", () => ({
  publishMessage: mocks.publishMessage,
  publishEntry: vi.fn(),
}));

import { resolveRedisChannelConfig } from "../src/config.js";
import { handleInboundMessage } from "../src/inbound.js";
import { setRedisStreamRuntime } from "../src/runtime.js";
import type { RedisChannelConfig, RedisInboundMessage } from "../src/types.js";

const { dispatchChannelMessage, resolveChannelDispatchIdentity, publishMessage } = mocks;

function baseConfig(overrides: Partial<RedisChannelConfig> = {}): RedisChannelConfig {
  return {
    ...resolveRedisChannelConfig({}),
    subscribeChannels: ["openclaw:agent:*:in"],
    channelBindings: [
      {
        channelPattern: "openclaw:agent:demo:in",
        agentId: "demo",
        accountId: "default",
        replyChannel: "openclaw:agent:demo:out",
      },
    ],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<RedisInboundMessage> = {}): RedisInboundMessage {
  return {
    channel: "openclaw:agent:demo:in",
    message: "hello redis",
    ...overrides,
  };
}

describe("handleInboundMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setRedisStreamRuntime({ config: {} } as never);
  });

  it("skips outbound channels to prevent feedback loop", async () => {
    const ok = await handleInboundMessage(
      makeMessage({ channel: "openclaw:agent:demo:out" }),
      baseConfig(),
    );
    expect(ok).toBe(true);
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("ACKs non-matching subscribe channel without dispatch", async () => {
    const ok = await handleInboundMessage(
      makeMessage({ channel: "other:channel" }),
      baseConfig({ subscribeChannels: ["openclaw:agent:demo:in"] }),
    );
    expect(ok).toBe(true);
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("dispatches bound channel messages", async () => {
    const ok = await handleInboundMessage(
      makeMessage({ message: "bound msg", id: `redis-in-${Date.now()}` }),
      baseConfig(),
    );

    expect(ok).toBe(true);
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
    expect(dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      channel: "redis-stream",
      text: "bound msg",
      peerId: "openclaw:agent:demo:in",
    });
  });

  it("uses fieldAgentId override for routing", async () => {
    await handleInboundMessage(
      makeMessage({
        channel: "openclaw:agent:demo:in",
        fieldAgentId: "field-agent",
        fieldAccountId: "team-a",
        id: `redis-field-${Date.now()}`,
      }),
      baseConfig(),
    );

    expect(resolveChannelDispatchIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: "field-agent", accountId: "team-a" }),
    );
  });

  it("reply deliver publishes to reply channel", async () => {
    await handleInboundMessage(
      makeMessage({ id: `redis-reply-${Date.now()}` }),
      baseConfig(),
    );

    const reply = dispatchChannelMessage.mock.calls[0][0].reply as {
      deliver: (p: { wire: string }) => Promise<void>;
    };
    await reply.deliver({ wire: '{"text":"pong"}' });
    expect(publishMessage).toHaveBeenCalledWith("openclaw:agent:demo:out", '{"text":"pong"}');
  });

  it("drops duplicate message ids", async () => {
    const id = `redis-dedup-${Date.now()}`;
    const config = baseConfig();
    const msg = makeMessage({ id, message: "once" });

    expect(await handleInboundMessage(msg, config)).toBe(true);
    expect(await handleInboundMessage(msg, config)).toBe(true);
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
  });

  it("returns false when runtime is missing", async () => {
    setRedisStreamRuntime(null as never);
    const ok = await handleInboundMessage(
      makeMessage({ id: `redis-no-rt-${Date.now()}` }),
      baseConfig(),
    );
    expect(ok).toBe(false);
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("falls back to defaultAgentId when no binding matches", async () => {
    await handleInboundMessage(
      makeMessage({
        channel: "custom:events:ingress",
        id: `redis-default-${Date.now()}`,
      }),
      baseConfig({
        subscribeChannels: [],
        channelBindings: [],
        defaultAgentId: "fallback-agent",
      }),
    );

    expect(resolveChannelDispatchIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: "fallback-agent" }),
    );
  });
});

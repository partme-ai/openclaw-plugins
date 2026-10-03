import { beforeEach, describe, expect, it, vi } from "vitest";

const hookMocks = vi.hoisted(() => ({
  getGlobalHookRunner: vi.fn(),
  runMessageSent: vi.fn(async () => undefined),
}));

vi.mock("openclaw/plugin-sdk/plugin-runtime", () => ({
  getGlobalHookRunner: hookMocks.getGlobalHookRunner,
}));

import { createReplyHandler } from "./reply-bridge.js";
import type { BridgePluginRuntime } from "./types.js";

function runtimeWithFactory(factory: (params: unknown) => unknown): BridgePluginRuntime {
  return {
    config: {},
    channel: {
      routing: { resolveAgentRoute: vi.fn() },
      reply: {
        finalizeInboundContext: vi.fn(),
        createReplyDispatcherWithTyping: factory as BridgePluginRuntime["channel"]["reply"]["createReplyDispatcherWithTyping"],
        dispatchReplyFromConfig: vi.fn(),
      },
    },
  };
}

describe("createReplyHandler", () => {
  beforeEach(() => {
    hookMocks.runMessageSent.mockClear();
    hookMocks.getGlobalHookRunner.mockReset().mockReturnValue(null);
  });

  it("unwraps the OpenClaw 2026.7.1 dispatcher bundle", () => {
    const dispatcher = { sendFinalReply: vi.fn() };
    const replyOptions = { onReplyStart: vi.fn() };
    const result = createReplyHandler({
      runtime: runtimeWithFactory(() => ({ dispatcher, replyOptions })),
      channel: "mqtt",
      accountId: "default",
      peerId: "peer-1",
      deliver: vi.fn(),
    });

    expect(result).toEqual({ dispatcher, replyOptions });
  });

  it("keeps compatibility with runtimes returning a dispatcher directly", () => {
    const dispatcher = { sendFinalReply: vi.fn() };
    const result = createReplyHandler({
      runtime: runtimeWithFactory(() => dispatcher),
      channel: "mqtt",
      accountId: "default",
      peerId: "peer-1",
      deliver: vi.fn(),
    });

    expect(result).toEqual({ dispatcher, replyOptions: {} });
  });

  it("emits message_sent only after the custom transport succeeds", async () => {
    let transportDeliver: ((payload: { text: string }) => Promise<void>) | undefined;
    const deliver = vi.fn(async () => undefined);
    hookMocks.getGlobalHookRunner.mockReturnValue({
      hasHooks: (name: string) => name === "message_sent",
      runMessageSent: hookMocks.runMessageSent,
    });

    createReplyHandler({
      runtime: runtimeWithFactory((params) => {
        transportDeliver = (params as { deliver: typeof transportDeliver }).deliver;
        return { dispatcher: {}, replyOptions: {} };
      }),
      channel: "mqtt",
      accountId: "device-fleet",
      peerId: "sensor-1",
      sessionKey: "agent:main:mqtt:sensor-1",
      deliver,
    });

    await transportDeliver?.({ text: "reply" });

    expect(deliver).toHaveBeenCalledOnce();
    expect(hookMocks.runMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({ to: "sensor-1", content: "reply", success: true }),
      expect.objectContaining({
        channelId: "mqtt",
        accountId: "device-fleet",
        conversationId: "sensor-1",
        sessionKey: "agent:main:mqtt:sensor-1",
      }),
    );
  });

  it("emits a failed message_sent event and preserves the transport error", async () => {
    let transportDeliver: ((payload: { text: string }) => Promise<void>) | undefined;
    const transportError = new Error("broker rejected publish");
    hookMocks.getGlobalHookRunner.mockReturnValue({
      hasHooks: (name: string) => name === "message_sent",
      runMessageSent: hookMocks.runMessageSent,
    });

    createReplyHandler({
      runtime: runtimeWithFactory((params) => {
        transportDeliver = (params as { deliver: typeof transportDeliver }).deliver;
        return { dispatcher: {}, replyOptions: {} };
      }),
      channel: "mqtt",
      accountId: "default",
      peerId: "sensor-2",
      deliver: vi.fn(async () => {
        throw transportError;
      }),
    });

    await expect(transportDeliver?.({ text: "reply" })).rejects.toBe(transportError);
    expect(hookMocks.runMessageSent).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "sensor-2",
        content: "reply",
        success: false,
        error: "broker rejected publish",
      }),
      expect.objectContaining({ channelId: "mqtt", accountId: "default" }),
    );
  });
});

describe("structured reply bridge", () => {
  it("rejects media without authorization before calling the transport", async () => {
    let send: any;
    const deliver = vi.fn();
    createReplyHandler({ runtime: runtimeWithFactory((params: any) => { send = params.deliver; return {}; }),
      channel: "mqtt", accountId: "a", peerId: "p", outboundFormat: "structured-v1", deliver,
    } as never);
    await expect(send({ text: "caption", mediaUrl: "https://media.example.org/a.png" })).rejects.toThrow(/authoriz/);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("keeps explicitly ordered text parts and reply/thread identities", async () => {
    let send: any;
    const deliver = vi.fn();
    createReplyHandler({ runtime: runtimeWithFactory((params: any) => { send = params.deliver; return {}; }),
      channel: "mqtt", accountId: "a", peerId: "p", outboundFormat: "structured-v1", deliver,
    } as never);
    const structured = { schemaVersion: 1, messageId: "m", deliveryId: "d", replyTo: "parent", threadId: "thread", parts: [{ type: "text", text: "a" }, { type: "text", text: "b" }] };
    await send({ text: "ignored flattened", structured });
    expect(JSON.parse(deliver.mock.calls[0][0].wire)).toEqual({ format: "structured-v1", ...structured });
  });
});

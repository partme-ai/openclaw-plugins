import { describe, expect, it, vi } from "vitest";
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
});

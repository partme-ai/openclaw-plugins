import { describe, expect, it, vi } from "vitest";
import { dispatchInbound } from "./inbound-bridge.js";

describe("dispatchInbound", () => {
  it("builds the canonical OpenClaw 2026.7.1 inbound context", async () => {
    const finalizeInboundContext = vi.fn(async (ctx) => ctx);
    const dispatchReplyFromConfig = vi.fn(async () => undefined);
    const config = { agents: { defaults: { model: { primary: "e2e/fixture" } } } };
    const current = vi.fn(async () => config);
    const runtime = {
      config: { current },
      channel: {
        routing: { resolveAgentRoute: vi.fn(async () => ({ agentId: "main" })) },
        reply: {
          finalizeInboundContext,
          createReplyDispatcherWithTyping: vi.fn(() => ({
            dispatcher: {},
            replyOptions: {},
          })),
          dispatchReplyFromConfig,
        },
      },
    };

    await dispatchInbound({
      runtime,
      channel: "mqtt",
      accountId: "default",
      peerId: "device-1",
      text: "hello agent",
      agentId: "main",
      unified: null,
      extra: { topic: "openclaw/agent/main/in" },
      reply: {
        sessionKey: "agent:main:main",
        deliver: vi.fn(),
      },
    });

    expect(finalizeInboundContext).toHaveBeenCalledWith(expect.objectContaining({
      Body: "hello agent",
      BodyForAgent: "hello agent",
      RawBody: "hello agent",
      CommandBody: "hello agent",
      From: "device-1",
      To: "default",
      SessionKey: "agent:main:main",
      AccountId: "default",
      ChatType: "direct",
      Provider: "mqtt",
      Surface: "mqtt",
      DesiredAgentId: "main",
      topic: "openclaw/agent/main/in",
    }));
    expect(current).toHaveBeenCalled();
    expect(dispatchReplyFromConfig).toHaveBeenCalledWith(expect.objectContaining({ cfg: config }));
    expect(dispatchReplyFromConfig).toHaveBeenCalledOnce();
  });

  it("waits for asynchronous reply delivery before completing wire dispatch", async () => {
    const order: string[] = [];
    const dispatcher = {
      waitForIdle: vi.fn(async () => {
        order.push("delivery-settled");
      }),
    };
    const runtime = {
      config: { current: vi.fn(async () => ({})) },
      channel: {
        routing: { resolveAgentRoute: vi.fn(async () => ({ agentId: "main" })) },
        reply: {
          finalizeInboundContext: vi.fn(async (ctx) => ctx),
          createReplyDispatcherWithTyping: vi.fn(() => ({ dispatcher, replyOptions: {} })),
          dispatchReplyFromConfig: vi.fn(async () => {
            order.push("dispatch-returned");
          }),
        },
      },
    };

    await dispatchInbound({
      runtime,
      channel: "rabbitmq",
      accountId: "default",
      peerId: "device-1",
      text: "hello agent",
      reply: { deliver: vi.fn() },
    });

    expect(dispatcher.waitForIdle).toHaveBeenCalledOnce();
    expect(order).toEqual(["dispatch-returned", "delivery-settled"]);
  });
});

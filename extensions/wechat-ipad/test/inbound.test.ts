import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearRecentWechatIpadMessages, dispatchToRuntime, handleWxMessage } from "../src/inbound.js";
import { setWechatIpadRuntime } from "../src/runtime.js";
import { DEFAULT_CONFIG, WxMsgType, type WxMessagePayload } from "../src/types.js";

vi.mock("../src/transport/ipad-bridge.js", async (loadOriginal) => ({
  ...(await loadOriginal<typeof import("../src/transport/ipad-bridge.js")>()),
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
}));

function message(overrides: Partial<WxMessagePayload> = {}): WxMessagePayload {
  return {
    msgId: "m1",
    fromWxid: "wxid_user",
    toWxid: "wxid_self",
    msgType: WxMsgType.Text,
    content: "hello",
    createTime: 1,
    isGroup: false,
    isSelf: false,
    ...overrides,
  };
}

function runtimeMock() {
  const dispatchReplyFromConfig = vi.fn().mockResolvedValue({});
  const finalizeInboundContext = vi.fn((value) => value);
  const resolveAgentRoute = vi.fn().mockResolvedValue({ agentId: "agent-1", sessionKey: "session-1" });
  const dispatcher = { waitForIdle: vi.fn(), markComplete: vi.fn() };
  return {
    config: { current: () => ({ channels: {} }) },
    channel: {
      routing: { resolveAgentRoute },
      reply: {
        finalizeInboundContext,
        createReplyDispatcherWithTyping: vi.fn(() => ({
          dispatcher,
          replyOptions: {},
          markDispatchIdle: vi.fn(),
          markRunComplete: vi.fn(),
        })),
        dispatchReplyFromConfig,
        withReplyDispatcher: vi.fn(async ({ run }) => run()),
      },
    },
    spies: { dispatchReplyFromConfig, finalizeInboundContext, resolveAgentRoute },
  };
}

describe("wechat-ipad inbound", () => {
  beforeEach(() => clearRecentWechatIpadMessages());

  it("drops self, disabled groups, non-whitelisted groups, and duplicates", async () => {
    const runtime = runtimeMock();
    setWechatIpadRuntime(runtime as never);
    await handleWxMessage(message({ isSelf: true }), DEFAULT_CONFIG);
    await handleWxMessage(message({ msgId: "g1", isGroup: true, toWxid: "group-x" }), DEFAULT_CONFIG);
    const scoped = {
      ...DEFAULT_CONFIG,
      message: { ...DEFAULT_CONFIG.message, handleGroup: true, groupWhitelist: ["group-a"] },
    };
    await handleWxMessage(message({ msgId: "g2", isGroup: true, toWxid: "group-x" }), scoped);
    await handleWxMessage(message({ msgId: "d1" }), DEFAULT_CONFIG);
    await handleWxMessage(message({ msgId: "d1" }), DEFAULT_CONFIG);
    expect(runtime.spies.resolveAgentRoute).toHaveBeenCalledOnce();
  });

  it("builds a 2026.7.1 inbound context without logging message content", async () => {
    const runtime = runtimeMock();
    setWechatIpadRuntime(runtime as never);
    await dispatchToRuntime({
      conversation: "wxid_peer",
      sender: "wxid_peer",
      text: "private content",
      isGroup: false,
      messageId: "m-2",
    });
    expect(runtime.spies.resolveAgentRoute).toHaveBeenCalledWith(expect.objectContaining({
      peer: { kind: "direct", id: "wxid_peer" },
    }));
    expect(runtime.spies.finalizeInboundContext).toHaveBeenCalledWith(expect.objectContaining({
      Body: "private content",
      SessionKey: "session-1",
      Provider: "wechat-ipad",
    }));
    expect(runtime.spies.dispatchReplyFromConfig).toHaveBeenCalledOnce();
  });

  it("throws when runtime is missing", async () => {
    setWechatIpadRuntime(null as never);
    await expect(dispatchToRuntime({ conversation: "x", sender: "x", text: "x", isGroup: false }))
      .rejects.toThrow("not initialized");
  });
});

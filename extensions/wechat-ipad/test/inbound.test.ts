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

function directConfig(commandAllowFrom: string[] = []) {
  return {
    ...DEFAULT_CONFIG,
    enabled: true,
    acknowledgeUnofficialProtocolRisk: true,
    message: {
      ...DEFAULT_CONFIG.message,
      allowFrom: ["wxid_user"],
      commandAllowFrom,
    },
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
    const config = directConfig();
    await handleWxMessage(message({ isSelf: true }), config);
    await handleWxMessage(message({ msgId: "g1", isGroup: true, toWxid: "group-x" }), config);
    const scoped = {
      ...config,
      message: { ...config.message, handleGroup: true, groupWhitelist: ["group-a"] },
    };
    await handleWxMessage(message({ msgId: "g2", isGroup: true, toWxid: "group-x" }), scoped);
    await handleWxMessage(message({ msgId: "d1" }), config);
    await handleWxMessage(message({ msgId: "d1" }), config);
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
      CommandAuthorized: false,
    }));
    expect(runtime.spies.dispatchReplyFromConfig).toHaveBeenCalledOnce();
  });

  it("throws when runtime is missing", async () => {
    setWechatIpadRuntime(null as never);
    await expect(dispatchToRuntime({ conversation: "x", sender: "x", text: "x", isGroup: false }))
      .rejects.toThrow("not initialized");
  });

  it("allows a failed Agent dispatch to be retried with the same message id", async () => {
    const runtime = runtimeMock();
    runtime.spies.dispatchReplyFromConfig
      .mockRejectedValueOnce(new Error("temporary Agent failure"))
      .mockResolvedValueOnce({});
    setWechatIpadRuntime(runtime as never);

    const config = directConfig();
    await expect(handleWxMessage(message({ msgId: "retry-1" }), config))
      .rejects.toThrow("temporary Agent failure");
    await expect(handleWxMessage(message({ msgId: "retry-1" }), config)).resolves.toBeUndefined();

    expect(runtime.spies.dispatchReplyFromConfig).toHaveBeenCalledTimes(2);
  });

  it("rejects unknown direct senders and authorizes commands only through commandAllowFrom", async () => {
    const runtime = runtimeMock();
    setWechatIpadRuntime(runtime as never);

    await handleWxMessage(message({ msgId: "unknown", fromWxid: "wxid_unknown" }), directConfig());
    await handleWxMessage(message({ msgId: "chat" }), directConfig());
    await handleWxMessage(message({ msgId: "owner" }), directConfig(["wxid_user"]));

    expect(runtime.spies.dispatchReplyFromConfig).toHaveBeenCalledTimes(2);
    expect(runtime.spies.finalizeInboundContext.mock.calls[0]?.[0]).toMatchObject({
      MessageSid: "chat",
      CommandAuthorized: false,
    });
    expect(runtime.spies.finalizeInboundContext.mock.calls[1]?.[0]).toMatchObject({
      MessageSid: "owner",
      CommandAuthorized: true,
    });
  });

  it("covers disabled/open DM policy, allow-all groups and malformed or oversized input", async () => {
    const runtime = runtimeMock();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    setWechatIpadRuntime(runtime as never);
    const base = directConfig();

    await handleWxMessage(message({ msgId: "invalid", fromWxid: "" }), base, logger);
    await handleWxMessage(message({ msgId: "disabled" }), {
      ...base,
      message: { ...base.message, dmPolicy: "disabled" },
    }, logger);
    await handleWxMessage(message({ msgId: "oversized", content: "too long" }), {
      ...base,
      message: { ...base.message, maxTextChars: 2 },
    }, logger);
    await handleWxMessage(message({ msgId: "open", fromWxid: "wxid_anyone" }), {
      ...base,
      message: { ...base.message, dmPolicy: "open", allowFrom: [] },
    }, logger);
    await handleWxMessage(message({
      msgId: "group-open",
      fromWxid: "group-all",
      toWxid: "group-all",
      groupSenderWxid: "wxid-owner",
      isGroup: true,
    }), {
      ...base,
      message: {
        ...base.message,
        handleGroup: true,
        allowAllGroups: true,
        commandAllowFrom: ["wxid-owner"],
      },
    }, logger);

    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(runtime.spies.finalizeInboundContext).toHaveBeenCalledTimes(2);
    expect(runtime.spies.finalizeInboundContext.mock.calls[1]?.[0]).toMatchObject({
      ChatType: "group",
      CommandAuthorized: true,
    });
  });
});

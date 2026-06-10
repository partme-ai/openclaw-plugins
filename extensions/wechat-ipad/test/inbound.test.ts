/**
 * WeChat iPad inbound filtering and dispatch tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchToRuntime, handleWxMessage } from "../src/inbound.js";
import { clearAllSessions } from "../src/routing/session-mapper.js";
import {
  setResolvedWechatIpadConfig,
  setWechatIpadRuntime,
} from "../src/runtime.js";
import { DEFAULT_CONFIG, WxMsgType, type WxMessagePayload, type WechatIpadConfig } from "../src/types.js";

vi.mock("../src/transport/ipad-bridge.js", () => ({
  sendMessage: vi.fn().mockResolvedValue({ ok: true }),
  on: vi.fn(),
}));

function baseMsg(overrides: Partial<WxMessagePayload> = {}): WxMessagePayload {
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

function createRuntimeMock() {
  const dispatchReplyFromConfig = vi.fn().mockResolvedValue(undefined);
  const finalizeInboundContext = vi.fn().mockResolvedValue({ ctx: true });
  const createReplyDispatcherWithTyping = vi.fn().mockReturnValue({ typing: true });
  const resolveAgentRoute = vi.fn().mockResolvedValue({ agentId: "agent-1" });

  return {
    config: { channels: {} },
    channel: {
      routing: { resolveAgentRoute },
      reply: {
        finalizeInboundContext,
        createReplyDispatcherWithTyping,
        dispatchReplyFromConfig,
      },
    },
    spies: {
      dispatchReplyFromConfig,
      finalizeInboundContext,
      resolveAgentRoute,
    },
  };
}

describe("handleWxMessage filters", () => {
  beforeEach(() => {
    clearAllSessions();
    setWechatIpadRuntime(null as never);
  });

  it("ignores self messages when ignoreself enabled", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    handleWxMessage(baseMsg({ isSelf: true }), DEFAULT_CONFIG);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("drops group messages when handleGroup disabled", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    handleWxMessage(
      baseMsg({ isGroup: true, toWxid: "wxid_group", content: "hi" }),
      DEFAULT_CONFIG,
    );
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("drops group not in whitelist when whitelist configured", () => {
    const cfg: WechatIpadConfig = {
      ...DEFAULT_CONFIG,
      message: {
        ...DEFAULT_CONFIG.message,
        handleGroup: true,
        groupWhitelist: ["wxid_allowed"],
      },
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    handleWxMessage(
      baseMsg({ isGroup: true, toWxid: "wxid_other", content: "hi" }),
      cfg,
    );

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("accepts whitelisted group messages", () => {
    const cfg: WechatIpadConfig = {
      ...DEFAULT_CONFIG,
      message: {
        ...DEFAULT_CONFIG.message,
        handleGroup: true,
        groupWhitelist: ["wxid_group"],
      },
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    handleWxMessage(
      baseMsg({ isGroup: true, toWxid: "wxid_group", content: "team update" }),
      cfg,
    );

    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("skips non-text convertible messages", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    handleWxMessage(baseMsg({ msgType: WxMsgType.System }), DEFAULT_CONFIG);
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

describe("dispatchToRuntime", () => {
  beforeEach(() => {
    clearAllSessions();
    setResolvedWechatIpadConfig(DEFAULT_CONFIG);
  });

  it("warns when runtime is not initialized", async () => {
    setWechatIpadRuntime(null as never);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await dispatchToRuntime("wxid_user", "wxid_user", "hello", false);

    expect(warnSpy).toHaveBeenCalledWith(
      "[wechat-ipad] Runtime not initialized, cannot dispatch",
    );
    warnSpy.mockRestore();
  });

  it("routes direct messages through OpenClaw reply pipeline", async () => {
    const runtime = createRuntimeMock();
    setWechatIpadRuntime(runtime as never);

    await dispatchToRuntime("wxid_peer", "wxid_peer", "hello", false);

    expect(runtime.spies.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "wechat-ipad",
        peer: { kind: "dm", id: "wxid_peer" },
      }),
    );
    expect(runtime.spies.finalizeInboundContext).toHaveBeenCalledOnce();
    expect(runtime.spies.dispatchReplyFromConfig).toHaveBeenCalledOnce();
  });

  it("uses group peer kind for group conversations", async () => {
    const runtime = createRuntimeMock();
    setWechatIpadRuntime(runtime as never);

    await dispatchToRuntime("wxid_group", "wxid_member", "question", true);

    expect(runtime.spies.resolveAgentRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        peer: { kind: "group", id: "wxid_group" },
      }),
    );
  });
});

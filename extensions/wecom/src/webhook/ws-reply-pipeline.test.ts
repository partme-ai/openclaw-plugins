/**
 * WS 首响耗时观测与 early thinking 行为测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sendWeComReplyNonBlockingMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../dispatch/message-sender.js", () => ({
  sendWeComReplyNonBlocking: sendWeComReplyNonBlockingMock,
  sendWeComReply: vi.fn(),
  StreamExpiredError: class StreamExpiredError extends Error {},
}));

vi.mock("../runtime.js", () => ({
  getWeComRuntime: vi.fn(() => ({
    channel: {
      reply: {
        resolveHumanDelayConfig: vi.fn(() => undefined),
      },
    },
  })),
}));

const transcriptHookCapture = vi.hoisted(() => ({
  onReplyStartExtra: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("@partme.ai/openclaw-message-sdk/transcript", () => ({
  createTranscriptReplyDispatcherHooks: vi.fn((opts: { onReplyStartExtra?: () => Promise<void> }) => {
    transcriptHookCapture.onReplyStartExtra = opts.onReplyStartExtra;
    return {
      dispatcherOptions: { onError: undefined },
      replyOptions: {},
    };
  }),
  shouldShowStreamStatusLine: vi.fn(() => false),
  createChannelMessageReplyPipeline: vi.fn(),
  createReplyPrefixContext: vi.fn(),
  isChannelProgressDraftWorkToolName: vi.fn(() => false),
  formatChannelProgressDraftLineForEntry: vi.fn(),
}));

vi.mock("../config/streaming-config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/streaming-config.js")>();
  return {
    ...actual,
    resolveWecomStreamingConfig: vi.fn(() => ({
      mode: "partial",
      footerStatus: true,
      footerElapsed: false,
      streaming: false,
      streamingContent: false,
    })),
    resolveWecomStreamPlaceholderText: vi.fn((_cfg, fallback: string) => fallback),
  };
});

vi.mock("../config/templates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/templates.js")>();
  return {
    ...actual,
    resolveWecomTemplates: vi.fn(() => actual.WECOM_DEFAULT_TEMPLATES),
  };
});

import { createWsWecomReplyDispatcher } from "./ws-reply-pipeline.js";
import { isWeComWsTimingEnabled, logWsTimingStage, createWsTimingContext } from "../dispatch/ws-timing.js";

describe("ws-timing", () => {
  const original = process.env.WECOM_WS_TIMING;

  beforeEach(() => {
    if (original === undefined) {
      delete process.env.WECOM_WS_TIMING;
    } else {
      process.env.WECOM_WS_TIMING = original;
    }
  });

  it("is disabled by default", () => {
    delete process.env.WECOM_WS_TIMING;
    delete process.env.OPENCLAW_DEBUG;
    expect(isWeComWsTimingEnabled()).toBe(false);
  });

  it("is enabled when WECOM_WS_TIMING=1", () => {
    process.env.WECOM_WS_TIMING = "1";
    expect(isWeComWsTimingEnabled()).toBe(true);
  });

  it("logWsTimingStage emits when enabled", () => {
    process.env.WECOM_WS_TIMING = "1";
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const ctx = createWsTimingContext({
      accountId: "default",
      chatId: "user123456",
      messageId: "msg-abcdefgh",
    });
    logWsTimingStage(ctx, "thinking.early.sent");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("stage=thinking.early.sent"));
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("account=default"));
    spy.mockRestore();
  });
});

describe("createWsWecomReplyDispatcher early thinking dedup", () => {
  const baseParams = {
    wsClient: {} as never,
    frame: { body: { chatid: "c1", from: { userid: "u1" } }, headers: { req_id: "r1" } } as never,
    account: {
      accountId: "default",
      sendThinkingMessage: true,
      config: {},
    } as never,
    runtime: { log: vi.fn(), error: vi.fn() } as never,
    config: {} as never,
    agentId: "main",
  };

  beforeEach(() => {
    sendWeComReplyNonBlockingMock.mockClear();
    transcriptHookCapture.onReplyStartExtra = undefined;
  });

  it("skips onReplyStartExtra thinking when thinkingSentEarly is true", async () => {
    const state = {
      accumulatedText: "",
      streamId: "stream-1",
      thinkingSentEarly: true,
    };
    createWsWecomReplyDispatcher({ ...baseParams, state });
    await transcriptHookCapture.onReplyStartExtra?.();
    expect(sendWeComReplyNonBlockingMock).not.toHaveBeenCalled();
  });

  it("sends thinking on reply start when not sent early", async () => {
    const state = {
      accumulatedText: "",
      streamId: "stream-2",
    };
    createWsWecomReplyDispatcher({ ...baseParams, state });
    await transcriptHookCapture.onReplyStartExtra?.();
    expect(sendWeComReplyNonBlockingMock).toHaveBeenCalledTimes(1);
  });
});

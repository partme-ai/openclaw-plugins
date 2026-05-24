/**
 * early thinking 与 WS 慢阶段耗时日志测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendThinkingReplyMock = vi.hoisted(() => vi.fn(async () => undefined));
const pushWecomStreamStatusLineMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../webhook/ws-reply-pipeline.js", () => ({
  sendThinkingReply: sendThinkingReplyMock,
  pushWecomStreamStatusLine: pushWecomStreamStatusLineMock,
}));

vi.mock("../config/templates.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/templates.js")>();
  return {
    ...actual,
    resolveWecomTemplates: vi.fn((accountOrConfig: unknown) =>
      actual.resolveWecomTemplates(accountOrConfig as never),
    ),
  };
});

import {
  createWecomEarlyThinkingStreamId,
  pushWecomQueuedStatusIfNeeded,
  sendWecomEarlyThinking,
  shouldSendWecomEarlyThinking,
} from "./ws-early-thinking.js";
import {
  createWsTimingContext,
  logWsTimingStage,
  WECOM_WS_SLOW_STAGE_MS,
} from "./ws-timing.js";

describe("ws-early-thinking", () => {
  const baseParams = {
    wsClient: {} as never,
    frame: { body: {}, headers: { req_id: "r1" } } as never,
    streamId: "stream-test",
    account: { accountId: "default", sendThinkingMessage: true, config: {} } as never,
    runtime: { log: vi.fn(), error: vi.fn() } as never,
  };

  beforeEach(() => {
    sendThinkingReplyMock.mockClear();
    pushWecomStreamStatusLineMock.mockClear();
    baseParams.runtime.log = vi.fn();
    baseParams.runtime.error = vi.fn();
  });

  it("shouldSendWecomEarlyThinking defaults to true", () => {
    expect(shouldSendWecomEarlyThinking({ sendThinkingMessage: undefined } as never)).toBe(true);
    expect(shouldSendWecomEarlyThinking({ sendThinkingMessage: false } as never)).toBe(false);
  });

  it("sendWecomEarlyThinking invokes sendThinkingReply", async () => {
    const sent = await sendWecomEarlyThinking(baseParams);
    expect(sent).toBe(true);
    expect(sendThinkingReplyMock).toHaveBeenCalledTimes(1);
    expect(sendThinkingReplyMock.mock.calls[0]?.[0]?.streamId).toBe("stream-test");
  });

  it("createWecomEarlyThinkingStreamId returns non-empty id", () => {
    expect(createWecomEarlyThinkingStreamId()).toMatch(/^stream/);
  });
});

describe("pushWecomQueuedStatusIfNeeded", () => {
  const base = {
    wsClient: {} as never,
    frame: { body: {}, headers: { req_id: "r1" } } as never,
    streamId: "stream-q",
    thinkingSentEarly: true,
    account: { accountId: "default", config: { queuedText: "CUSTOM_QUEUED" } } as never,
    runtime: { log: vi.fn(), error: vi.fn() } as never,
  };

  beforeEach(() => {
    pushWecomStreamStatusLineMock.mockClear();
  });

  it("pushes queuedText when early stream exists", async () => {
    const pushed = await pushWecomQueuedStatusIfNeeded(base);
    expect(pushed).toBe(true);
    expect(pushWecomStreamStatusLineMock).toHaveBeenCalledWith(
      expect.objectContaining({ statusLine: "CUSTOM_QUEUED", streamId: "stream-q" }),
    );
  });

  it("skips when thinking was not sent early", async () => {
    const pushed = await pushWecomQueuedStatusIfNeeded({
      ...base,
      thinkingSentEarly: false,
    });
    expect(pushed).toBe(false);
    expect(pushWecomStreamStatusLineMock).not.toHaveBeenCalled();
  });
});

describe("ws-timing slow stage", () => {
  const originalTiming = process.env.WECOM_WS_TIMING;

  beforeEach(() => {
    delete process.env.WECOM_WS_TIMING;
    delete process.env.OPENCLAW_DEBUG;
  });

  afterEach(() => {
    if (originalTiming === undefined) {
      delete process.env.WECOM_WS_TIMING;
    } else {
      process.env.WECOM_WS_TIMING = originalTiming;
    }
  });

  it("logs slow stages without WECOM_WS_TIMING via runtime.log", () => {
    const runtime = { log: vi.fn() };
    const originalNow = performance.now;
    let fakeNow = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow);

    const ctx = createWsTimingContext({
      accountId: "default",
      chatId: "chat123456",
      messageId: "msg-abcdefgh",
    });
    fakeNow += WECOM_WS_SLOW_STAGE_MS + 10;

    logWsTimingStage(ctx, "policy.dm.done", { allowed: true }, { runtime });

    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("[wecom-ws-slow]"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("stage=policy.dm.done"));

    vi.spyOn(performance, "now").mockImplementation(originalNow);
  });

  it("does not log fast stages without WECOM_WS_TIMING", () => {
    const runtime = { log: vi.fn() };
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const originalNow = performance.now;
    let fakeNow = 5000;
    vi.spyOn(performance, "now").mockImplementation(() => fakeNow);

    const ctx = createWsTimingContext({
      accountId: "default",
      chatId: "c1",
      messageId: "m1",
    });
    fakeNow += 50;

    logWsTimingStage(ctx, "parse.done", undefined, { runtime });
    expect(runtime.log).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
    vi.spyOn(performance, "now").mockImplementation(originalNow);
  });
});

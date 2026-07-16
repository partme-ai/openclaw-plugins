/**
 * Douyin webhook dispatch entry tests (idempotency + transcript routing).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const dispatchDouyinTranscriptTurnMock = vi.hoisted(() => vi.fn());

vi.mock("../src/dispatch/transcript-dispatch.js", () => ({
  dispatchDouyinTranscriptTurn: dispatchDouyinTranscriptTurnMock,
}));

import { dispatchDouyinWebhookInbound } from "../src/dispatch/dispatch-inbound.js";
import { resetDouyinWebhookDedupeForTests } from "../src/dispatch/inbound-dedupe.js";
import type { ResolvedDouyinAccount } from "../src/types.js";

const baseAccount: ResolvedDouyinAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  app_key: "k",
  app_secret: "s",
  shop_id: "shop-1",
  webhook_path: "/channels/douyin/webhook",
  config: { app_key: "k", app_secret: "s" },
};

function uniqueMessageId(prefix: string): string {
  return `${prefix}-${process.pid}-${Date.now()}-${Math.random()}`;
}

function transcriptRuntime(): PluginRuntime {
  return {
    config: {},
    channel: {
      routing: {
        resolveAgentRoute: vi.fn(),
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
      },
    },
  } as unknown as PluginRuntime;
}

describe("dispatchDouyinWebhookInbound", () => {
  beforeEach(() => {
    dispatchDouyinTranscriptTurnMock.mockReset();
    resetDouyinWebhookDedupeForTests();
  });

  it("returns duplicate when the same messageId is seen twice", async () => {
    const runtime = transcriptRuntime();
    dispatchDouyinTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "sk" },
      delivered: true,
    });

    const params = {
      runtime,
      cfg: {},
      account: baseAccount,
      rawBody: '{"text":"hello"}',
      text: '{"text":"hello"}',
      peerId: "user-1",
      messageId: uniqueMessageId("msg-dup"),
    };

    expect(await dispatchDouyinWebhookInbound(params)).toBe("dispatched");
    expect(await dispatchDouyinWebhookInbound(params)).toBe("duplicate");
    expect(dispatchDouyinTranscriptTurnMock).toHaveBeenCalledTimes(1);
  });

  it("returns skipped when transcript runtime unavailable", async () => {
    const result = await dispatchDouyinWebhookInbound({
      runtime: { config: {} } as PluginRuntime,
      cfg: {},
      account: baseAccount,
      rawBody: "plain text",
      text: "plain text",
      peerId: "user-2",
      messageId: "msg-skip-1",
    });
    expect(result).toBe("skipped");
  });

  it("returns dispatched when transcript turn succeeds", async () => {
    dispatchDouyinTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "agent:main:douyin:direct:user-3" },
      delivered: true,
    });
    const messageId = uniqueMessageId("msg-ok");

    const result = await dispatchDouyinWebhookInbound({
      runtime: transcriptRuntime(),
      cfg: {},
      account: baseAccount,
      rawBody: '{"content":{"text":"hi"}}',
      text: '{"content":{"text":"hi"}}',
      peerId: "user-3",
      messageId,
    });

    expect(result).toBe("dispatched");
    expect(dispatchDouyinTranscriptTurnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "default",
        peerId: "user-3",
        shopId: "shop-1",
        messageSid: messageId,
      }),
    );
  });

  it("returns timed_out when transcript dispatch reports timeout", async () => {
    dispatchDouyinTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "sk" },
      delivered: false,
      timedOut: true,
      dispatchTimeoutMs: 600_000,
      timeoutUserMessage: "抱歉，处理您的消息超时（约 10 分钟），请稍后重试。",
    });

    const log = { error: vi.fn() };
    const result = await dispatchDouyinWebhookInbound({
      runtime: transcriptRuntime(),
      cfg: {},
      account: baseAccount,
      rawBody: "slow",
      text: "slow",
      peerId: "user-4",
      messageId: "msg-timeout-1",
      log,
    });

    expect(result).toBe("timed_out");
    expect(log.error).toHaveBeenCalled();
  });

  it("returns skipped when transcript turn returns null", async () => {
    dispatchDouyinTranscriptTurnMock.mockResolvedValue(null);

    const result = await dispatchDouyinWebhookInbound({
      runtime: transcriptRuntime(),
      cfg: {},
      account: baseAccount,
      rawBody: "x",
      text: "x",
      peerId: "user-5",
      messageId: "msg-null-1",
    });

    expect(result).toBe("skipped");
  });

  it("releases the message claim when dispatch is skipped so a retry can succeed", async () => {
    dispatchDouyinTranscriptTurnMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ route: { sessionKey: "sk" }, delivered: false });
    const params = {
      runtime: transcriptRuntime(),
      cfg: {},
      account: baseAccount,
      rawBody: "retryable",
      text: "retryable",
      peerId: "user-retry",
      messageId: uniqueMessageId("msg-retry"),
    };

    expect(await dispatchDouyinWebhookInbound(params)).toBe("skipped");
    expect(await dispatchDouyinWebhookInbound(params)).toBe("dispatched");
    expect(dispatchDouyinTranscriptTurnMock).toHaveBeenCalledTimes(2);
  });

  it("accepts messages without messageId (no idempotency key)", async () => {
    dispatchDouyinTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "sk" },
      delivered: false,
    });

    const result = await dispatchDouyinWebhookInbound({
      runtime: transcriptRuntime(),
      cfg: {},
      account: baseAccount,
      rawBody: "no-id",
      text: "no-id",
      peerId: "user-6",
    });

    expect(result).toBe("dispatched");
  });
});

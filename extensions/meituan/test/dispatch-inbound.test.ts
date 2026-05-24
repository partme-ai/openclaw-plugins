/**
 * Meituan webhook dispatch entry tests.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const dispatchMeituanTranscriptTurnMock = vi.hoisted(() => vi.fn());

vi.mock("../src/dispatch/transcript-dispatch.js", () => ({
  dispatchMeituanTranscriptTurn: dispatchMeituanTranscriptTurnMock,
}));

import { dispatchWebhookInbound } from "../src/dispatch/dispatch-inbound.js";
import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";

function transcriptApi() {
  const runtime = {
    config: { channels: {} },
    channel: {
      routing: { resolveAgentRoute: vi.fn() },
      reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
    },
  } as unknown as PluginRuntime;

  return createMockPluginApi({ config: { channels: {} }, runtime }) as never;
}

describe("dispatchWebhookInbound (meituan)", () => {
  beforeEach(() => {
    dispatchMeituanTranscriptTurnMock.mockReset();
  });

  it("returns duplicate for repeated messageId", async () => {
    dispatchMeituanTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "sk" },
      delivered: true,
    });

    const api = transcriptApi();
    const params = {
      api,
      channel: "meituan",
      accountId: "default",
      peerId: "shop-1",
      shopId: "shop-1",
      rawBody: '{"text":"hi"}',
      messageId: "dup-meituan-1",
    };

    expect(await dispatchWebhookInbound(params)).toBe("dispatched");
    expect(await dispatchWebhookInbound(params)).toBe("duplicate");
  });

  it("returns dispatched via publishInbound fallback", async () => {
    const publishInbound = vi.fn(async () => undefined);
    const api = createMockPluginApi({
      runtime: {
        config: { channels: {} },
        channel: { publishInbound },
      },
    }) as never;

    const result = await dispatchWebhookInbound({
      api,
      channel: "meituan",
      accountId: "default",
      peerId: "shop-2",
      shopId: "shop-2",
      rawBody: "fallback text",
      messageId: "pub-1",
    });

    expect(result).toBe("dispatched");
    expect(publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "meituan",
        sessionId: "meituan:shop-2",
        content: "fallback text",
      }),
    );
  });

  it("returns skipped when no transcript runtime and no publishInbound", async () => {
    const api = createMockPluginApi({
      runtime: { config: { channels: {} }, channel: {} },
    }) as never;

    expect(
      await dispatchWebhookInbound({
        api,
        channel: "meituan",
        accountId: "default",
        peerId: "shop-3",
        shopId: "shop-3",
        rawBody: "x",
        messageId: "skip-1",
      }),
    ).toBe("skipped");
  });

  it("returns timed_out when transcript reports timeout", async () => {
    dispatchMeituanTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "sk" },
      delivered: false,
      timedOut: true,
      dispatchTimeoutMs: 600_000,
      timeoutUserMessage: "抱歉，处理您的消息超时（约 10 分钟），请稍后重试。",
    });

    const api = transcriptApi();
    const result = await dispatchWebhookInbound({
      api,
      channel: "meituan",
      accountId: "default",
      peerId: "shop-4",
      shopId: "shop-4",
      rawBody: '{"text":"slow"}',
      messageId: "timeout-1",
    });

    expect(result).toBe("timed_out");
  });

  it("returns skipped when transcript turn returns null", async () => {
    dispatchMeituanTranscriptTurnMock.mockResolvedValue(null);

    const api = transcriptApi();
    expect(
      await dispatchWebhookInbound({
        api,
        channel: "meituan",
        accountId: "default",
        peerId: "shop-5",
        shopId: "shop-5",
        rawBody: "x",
        messageId: "null-1",
      }),
    ).toBe("skipped");
  });
});

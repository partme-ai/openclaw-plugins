/**
 * Rednode webhook dispatch entry tests.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const dispatchXhsTranscriptTurnMock = vi.hoisted(() => vi.fn());

vi.mock("../src/dispatch/transcript-dispatch.js", () => ({
  dispatchXhsTranscriptTurn: dispatchXhsTranscriptTurnMock,
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

describe("dispatchWebhookInbound (rednode/xhs)", () => {
  beforeEach(() => {
    dispatchXhsTranscriptTurnMock.mockReset();
  });

  it("returns duplicate for repeated messageId", async () => {
    dispatchXhsTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "sk" },
      delivered: true,
    });

    const api = transcriptApi();
    const params = {
      api,
      channel: "xhs",
      accountId: "default",
      peerId: "shop-1",
      shopId: "shop-1",
      rawBody: '{"text":"hi"}',
      messageId: "xhs-dup-1",
    };

    expect(await dispatchWebhookInbound(params)).toBe("dispatched");
    expect(await dispatchWebhookInbound(params)).toBe("duplicate");
  });

  it("returns dispatched via publishInbound fallback", async () => {
    const publishInbound = vi.fn(async () => undefined);
    const api = createMockPluginApi({
      runtime: { config: {}, channel: { publishInbound } },
    }) as never;

    expect(
      await dispatchWebhookInbound({
        api,
        channel: "xhs",
        accountId: "default",
        peerId: "shop-2",
        shopId: "shop-2",
        rawBody: "fallback",
        messageId: "xhs-pub-1",
      }),
    ).toBe("dispatched");
    expect(publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "xhs:shop-2" }),
    );
  });

  it("returns timed_out when transcript reports timeout", async () => {
    dispatchXhsTranscriptTurnMock.mockResolvedValue({
      route: { sessionKey: "sk" },
      delivered: false,
      timedOut: true,
      dispatchTimeoutMs: 600_000,
      timeoutUserMessage: "抱歉，处理您的消息超时（约 10 分钟），请稍后重试。",
    });

    const api = transcriptApi();
    expect(
      await dispatchWebhookInbound({
        api,
        channel: "xhs",
        accountId: "default",
        peerId: "shop-3",
        shopId: "shop-3",
        rawBody: '{"text":"slow"}',
        messageId: "xhs-timeout-1",
      }),
    ).toBe("timed_out");
  });

  it("returns skipped when no runtime dispatch path", async () => {
    const api = createMockPluginApi({
      runtime: { config: {}, channel: {} },
    }) as never;

    expect(
      await dispatchWebhookInbound({
        api,
        channel: "xhs",
        accountId: "default",
        peerId: "shop-4",
        shopId: "shop-4",
        rawBody: "x",
        messageId: "xhs-skip-1",
      }),
    ).toBe("skipped");
  });
});

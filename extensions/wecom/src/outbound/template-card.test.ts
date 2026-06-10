/**
 * template-card 出站：cardSentText 模板 wiring。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const wecomFetchMock = vi.hoisted(() => vi.fn(async () => ({ ok: true })));
const useActiveReplyOnceMock = vi.hoisted(() =>
  vi.fn(async (_streamId: string, fn: (ctx: { responseUrl: string; proxyUrl?: string }) => Promise<void>) => {
    await fn({ responseUrl: "https://example.com/reply", proxyUrl: undefined });
  }),
);

vi.mock("../webhook/http.js", () => ({
  wecomFetch: wecomFetchMock,
}));

vi.mock("../webhook/active-reply.js", () => ({
  getActiveReplyUrl: vi.fn(() => "https://example.com/reply"),
  useActiveReplyOnce: useActiveReplyOnceMock,
}));

import { deliverTemplateCardIfPresent } from "./template-card.js";

describe("deliverTemplateCardIfPresent cardSentText", () => {
  const streamStore = {
    updateStream: vi.fn(),
  };

  const target = {
    account: {
      accountId: "default",
      config: { cardSentText: "CUSTOM_CARD_SENT" },
    },
    runtime: { log: vi.fn() },
    statusSink: vi.fn(),
  } as never;

  beforeEach(() => {
    streamStore.updateStream.mockClear();
    wecomFetchMock.mockClear();
  });

  it("uses cardSentText template after successful send", async () => {
    const cardJson = JSON.stringify({
      template_card: {
        card_type: "text_notice",
        task_id: "task-1",
        main_title: { title: "Notice" },
      },
    });

    const result = await deliverTemplateCardIfPresent({
      target,
      streamId: "stream-card",
      chatType: "direct",
      trimmedText: cardJson,
      streamStore,
    });

    expect(result).toEqual({ handled: true });
    expect(streamStore.updateStream).toHaveBeenCalledTimes(1);
    const updater = streamStore.updateStream.mock.calls[0]?.[1] as (s: {
      finished?: boolean;
      content?: string;
    }) => void;
    const state = { finished: false, content: "" };
    updater(state);
    expect(state.content).toBe("CUSTOM_CARD_SENT");
    expect(state.finished).toBe(true);
  });
});

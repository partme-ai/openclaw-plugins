import { describe, expect, it } from "vitest";
import {
  buildStreamBubbleText,
  resolveChannelStreamingConfig,
  shouldShowStreamStatusLine,
  syncStreamContent,
} from "./streaming-config.js";
import { formatElapsedFooter } from "./templates.js";

describe("resolveChannelStreamingConfig", () => {
  it("defaults to non-streaming with footer status on", () => {
    expect(resolveChannelStreamingConfig({})).toEqual({
      streaming: false,
      streamingStatus: false,
      streamingContent: false,
      footerStatus: true,
      footerElapsed: false,
    });
  });

  it("enables sub-switches when streaming is true", () => {
    const cfg = resolveChannelStreamingConfig({ streaming: true });
    expect(cfg.streamingStatus).toBe(true);
    expect(cfg.streamingContent).toBe(true);
  });
});

describe("buildStreamBubbleText", () => {
  it("composes sections with default separator", () => {
    const text = buildStreamBubbleText({
      statusLine: "thinking",
      answerText: "hello",
      footerLine: "done",
    });
    expect(text).toContain("thinking");
    expect(text).toContain("hello");
    expect(text).toContain("\n\n---\n\n");
  });
});

describe("syncStreamContent", () => {
  it("includes footer when configured", () => {
    const state = {
      content: "",
      statusLine: "status",
      answerText: "answer",
      replyStartedAt: 0,
    };
    syncStreamContent(
      state,
      resolveChannelStreamingConfig({ footer: { elapsed: true } }),
      {
        includeAnswer: true,
        includeFooter: true,
        finishedAt: 5000,
        formatElapsedFooter: (ms) => formatElapsedFooter(ms, "⏱ {elapsed}s · 已完成"),
      },
    );
    expect(state.content).toContain("answer");
    expect(state.content).toContain("⏱");
  });
});

describe("shouldShowStreamStatusLine", () => {
  it("respects footer and streaming.status", () => {
    expect(shouldShowStreamStatusLine(resolveChannelStreamingConfig({}))).toBe(true);
    expect(
      shouldShowStreamStatusLine(
        resolveChannelStreamingConfig({ footer: { status: false }, streaming: false }),
      ),
    ).toBe(false);
  });
});

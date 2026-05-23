import { describe, expect, it } from "vitest";
import {
  applyWecomWebhookEmptyContentFallback,
  buildWecomStreamBubbleText,
  formatWecomElapsedFooter,
  resolveWecomEnterChatWelcomeText,
  resolveWecomStreamingConfig,
  shouldShowWecomStatusLine,
  syncWecomStreamContent,
  WECOM_STATUS_THINKING,
} from "./streaming-config.js";
import type { WeComConfig } from "./utils.js";

describe("resolveWecomStreamingConfig", () => {
  it("defaults to non-streaming with footer status on", () => {
    const cfg = resolveWecomStreamingConfig({} as WeComConfig);
    expect(cfg).toEqual({
      streaming: false,
      streamingStatus: false,
      streamingContent: false,
      footerStatus: true,
      footerElapsed: false,
    });
  });

  it("enables sub-switches when streaming is true", () => {
    const cfg = resolveWecomStreamingConfig({ streaming: true } as WeComConfig);
    expect(cfg.streaming).toBe(true);
    expect(cfg.streamingStatus).toBe(true);
    expect(cfg.streamingContent).toBe(true);
  });

  it("respects nested streaming.status / content overrides", () => {
    const cfg = resolveWecomStreamingConfig({
      streaming: { status: false, content: true },
    } as WeComConfig);
    expect(cfg.streaming).toBe(true);
    expect(cfg.streamingStatus).toBe(false);
    expect(cfg.streamingContent).toBe(true);
  });

  it("respects footer overrides", () => {
    const cfg = resolveWecomStreamingConfig({
      footer: { status: false, elapsed: true },
    } as WeComConfig);
    expect(cfg.footerStatus).toBe(false);
    expect(cfg.footerElapsed).toBe(true);
  });
});

describe("buildWecomStreamBubbleText", () => {
  it("composes status, answer and footer with separators", () => {
    const text = buildWecomStreamBubbleText({
      statusLine: WECOM_STATUS_THINKING,
      answerText: "你好",
      footerLine: "⏱ 3s · 已完成",
    });
    expect(text).toContain(WECOM_STATUS_THINKING);
    expect(text).toContain("你好");
    expect(text).toContain("⏱ 3s · 已完成");
    expect(text).toContain("\n\n---\n\n");
  });

  it("can omit status on finish", () => {
    const text = buildWecomStreamBubbleText({
      answerText: "结果",
      footerLine: "⏱ 1s · 已完成",
      includeStatus: false,
    });
    expect(text).not.toContain(WECOM_STATUS_THINKING);
    expect(text).toContain("结果");
  });
});

describe("syncWecomStreamContent", () => {
  it("default mode keeps only status until final answer", () => {
    const state = {
      content: "",
      statusLine: WECOM_STATUS_THINKING,
      answerText: "partial",
      replyStartedAt: 0,
    };
    const cfg = resolveWecomStreamingConfig({
      streaming: false,
      footer: { status: true, elapsed: true },
    } as WeComConfig);
    syncWecomStreamContent(state, cfg, { includeAnswer: false });
    expect(state.content).toBe(WECOM_STATUS_THINKING);
    syncWecomStreamContent(state, cfg, { includeAnswer: true, includeFooter: true, finishedAt: 5000 });
    expect(state.content).toContain("partial");
    expect(state.content).toContain("⏱");
  });
});

describe("shouldShowWecomStatusLine", () => {
  it("true when footer.status or streaming.status enabled", () => {
    expect(shouldShowWecomStatusLine(resolveWecomStreamingConfig({} as WeComConfig))).toBe(true);
    expect(
      shouldShowWecomStatusLine(
        resolveWecomStreamingConfig({ footer: { status: false }, streaming: false } as WeComConfig),
      ),
    ).toBe(false);
    expect(
      shouldShowWecomStatusLine(
        resolveWecomStreamingConfig({
          streaming: { status: true, content: false },
        } as WeComConfig),
      ),
    ).toBe(true);
  });
});

describe("formatWecomElapsedFooter", () => {
  it("rounds to at least 1 second", () => {
    expect(formatWecomElapsedFooter(500)).toBe("⏱ 1s · 已完成");
    expect(formatWecomElapsedFooter(12_000)).toBe("⏱ 12s · 已完成");
  });
});

describe("resolveWecomEnterChatWelcomeText", () => {
  it("prefers welcomeText over streamPlaceholderContent", () => {
    expect(
      resolveWecomEnterChatWelcomeText({
        welcomeText: "欢迎",
        streamPlaceholderContent: "占位",
      } as WeComConfig),
    ).toBe("欢迎");
  });

  it("falls back to custom streamPlaceholderContent when welcomeText absent", () => {
    expect(
      resolveWecomEnterChatWelcomeText({
        streamPlaceholderContent: "正在连接…",
      } as WeComConfig),
    ).toBe("正在连接…");
  });

  it("returns undefined when only default placeholder is configured", () => {
    expect(
      resolveWecomEnterChatWelcomeText({ streamPlaceholderContent: "1" } as WeComConfig),
    ).toBeUndefined();
  });
});

describe("applyWecomWebhookEmptyContentFallback", () => {
  it("composes finish bubble via syncWecomStreamContent", () => {
    const state = { content: "", answerText: "", replyStartedAt: 0 };
    const cfg = resolveWecomStreamingConfig({
      streaming: false,
      footer: { status: true, elapsed: true },
    } as WeComConfig);
    applyWecomWebhookEmptyContentFallback(state, cfg, { finishedAt: 3000 });
    expect(state.content).toContain("✅ 已处理完成。");
    expect(state.content).toContain("⏱");
  });

  it("skips when content already present", () => {
    const state = { content: "已有内容", answerText: "" };
    const cfg = resolveWecomStreamingConfig({} as WeComConfig);
    applyWecomWebhookEmptyContentFallback(state, cfg);
    expect(state.content).toBe("已有内容");
  });
});

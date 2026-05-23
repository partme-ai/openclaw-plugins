import { describe, expect, it } from "vitest";
import {
  buildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary,
  resolveThinkingFinishText,
} from "./finish-thinking.js";
import type { MessageState } from "./interface.js";

describe("resolveThinkingFinishText", () => {
  it("优先返回累积文本", () => {
    const text = resolveThinkingFinishText({ accumulatedText: "你好" });
    expect(text).toBe("你好");
  });

  it("无文本但有模板卡片", () => {
    const text = resolveThinkingFinishText({
      accumulatedText: "",
      hasTemplateCard: true,
    });
    expect(text).toContain("卡片");
  });

  it("无文本但媒体发送成功", () => {
    const text = resolveThinkingFinishText({
      accumulatedText: "",
      hasMedia: true,
    });
    expect(text).toContain("文件已发送");
  });

  it("媒体失败时展示 mediaErrorSummary", () => {
    const text = resolveThinkingFinishText({
      accumulatedText: "",
      hasMedia: true,
      hasMediaFailed: true,
      mediaErrorSummary: "文件过大",
    });
    expect(text).toBe("文件过大");
  });

  it("dispatch 错误摘要", () => {
    const text = resolveThinkingFinishText({
      accumulatedText: "",
      dispatchErrorSummary: "超时了",
    });
    expect(text).toBe("超时了");
  });

  it("入站有媒体但无回复时使用媒体 fallback", () => {
    const text = resolveThinkingFinishText({
      accumulatedText: "",
      inboundHadMedia: true,
    });
    expect(text).toContain("未能解析该媒体");
  });

  it("完全空状态时仍返回通用 fallback，避免 thinking 残留", () => {
    const text = resolveThinkingFinishText({ accumulatedText: "" });
    expect(text.length).toBeGreaterThan(0);
  });
});

describe("buildAgentReplyTimeoutSummary", () => {
  it("至少显示 1 分钟", () => {
    expect(buildAgentReplyTimeoutSummary(30_000)).toContain("1 分钟");
    expect(buildAgentReplyTimeoutSummary(360_000)).toContain("6 分钟");
  });
});

describe("buildDispatchErrorSummary", () => {
  it("包含 kind 与错误信息", () => {
    const summary = buildDispatchErrorSummary("tool", new Error("boom"));
    expect(summary).toContain("tool");
    expect(summary).toContain("boom");
  });
});

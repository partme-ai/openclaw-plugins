import { describe, expect, it } from "vitest";
import {
  applyWecomWebhookStreamFinishContent,
  buildAgentReplyTimeoutSummary,
  buildDispatchErrorSummary,
  resolveThinkingFinishText,
} from "./finish-thinking.js";
import type { MessageState } from "../types/interface.js";
import { WECOM_DEFAULT_TEMPLATES } from "../config/templates.js";
import { isWecomTypingTemplateKey } from "../config/text-stages.js";

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
    expect(text).toBe(WECOM_DEFAULT_TEMPLATES.emptyReply);
  });

  it("emptyReply 不在 typing 模板键中", () => {
    expect(isWecomTypingTemplateKey("emptyReply")).toBe(false);
    expect(isWecomTypingTemplateKey("thinking")).toBe(true);
  });

  it("footer.elapsed 时在答案后附加耗时脚注", () => {
    const text = resolveThinkingFinishText(
      { accumulatedText: "答案", replyStartedAt: Date.now() - 12_000 },
      {
        streamingConfig: {
          streaming: false,
          streamingStatus: false,
          streamingContent: false,
          footerStatus: true,
          footerElapsed: true,
        },
      },
    );
    expect(text).toContain("答案");
    expect(text).toContain("⏱ 12s · 已完成");
  });
});

describe("applyWecomWebhookStreamFinishContent", () => {
  it("writes dispatch error summary only at finish, clearing status line", () => {
    const state = {
      content: WECOM_DEFAULT_TEMPLATES.thinking,
      statusLine: WECOM_DEFAULT_TEMPLATES.thinking,
      answerText: "",
      dispatchErrorSummary: "⚠️ 处理超时",
    };
    applyWecomWebhookStreamFinishContent(state, {
      streaming: false,
      streamingStatus: false,
      streamingContent: false,
      footerStatus: true,
      footerElapsed: false,
    });
    expect(state.content).toBe("⚠️ 处理超时");
    expect(state.statusLine).toBeUndefined();
    expect(state.content).not.toBe(WECOM_DEFAULT_TEMPLATES.thinking);
  });

  it("does not replace visible answer when dispatch succeeded", () => {
    const state = {
      content: "partial",
      answerText: "partial",
      statusLine: WECOM_DEFAULT_TEMPLATES.generating,
    };
    applyWecomWebhookStreamFinishContent(state, {
      streaming: false,
      streamingStatus: false,
      streamingContent: false,
      footerStatus: true,
      footerElapsed: false,
    });
    expect(state.content).toBe("partial");
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

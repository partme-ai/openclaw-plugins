import { describe, expect, it } from "vitest";
import { resolveStreamFinishText } from "./finish-stream.js";

const templates = {
  emptyReply: "empty",
  cardSent: "card sent",
  mediaSent: "media sent",
  mediaParseFailed: "parse failed {emptyReply}",
  finishFooter: "⏱ {elapsed}s · done",
};

describe("resolveStreamFinishText", () => {
  it("prefers accumulated text", () => {
    expect(resolveStreamFinishText({ accumulatedText: "hi" }, { templates })).toBe("hi");
  });

  it("never returns empty string", () => {
    expect(resolveStreamFinishText({}, { templates }).length).toBeGreaterThan(0);
  });

  it("appends elapsed footer when configured", () => {
    const text = resolveStreamFinishText(
      { accumulatedText: "answer", replyStartedAt: Date.now() - 12_000 },
      {
        templates,
        streamingConfig: {
          streaming: false,
          streamingStatus: false,
          streamingContent: false,
          footerStatus: true,
          footerElapsed: true,
        },
      },
    );
    expect(text).toContain("answer");
    expect(text).toContain("⏱");
  });
});

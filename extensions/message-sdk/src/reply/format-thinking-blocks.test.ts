import { describe, expect, it } from "vitest";
import {
  maskThinkingBlocks,
  restoreThinkingBlocks,
} from "./format-thinking-blocks.js";

describe("format-thinking-blocks", () => {
  it("masks and restores thinking blocks", () => {
    const raw = "hi <think>secret</think> bye";
    const { text, placeholders } = maskThinkingBlocks(raw);
    expect(text).not.toContain("secret");
    expect(placeholders).toHaveLength(1);
    const restored = restoreThinkingBlocks(`**${text}**`, placeholders);
    expect(restored).toContain("<think>secret</think>");
  });
});

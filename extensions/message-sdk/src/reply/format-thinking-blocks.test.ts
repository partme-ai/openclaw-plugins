/**
 * format-thinking-blocks.test.ts — 回复派发前处理、thinking 块遮罩与 dispatcher bundle。
 *
 * 这些测试锁定该模块的公开契约，防止命名、归一化、幂等或派发路径在重构时发生行为回退。
 */

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

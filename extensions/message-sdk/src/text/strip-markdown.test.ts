/**
 * strip-markdown 单元测试
 */
import { describe, expect, it } from "vitest";
import { stripMarkdown } from "./strip-markdown.js";

describe("stripMarkdown", () => {
  it("h1 标题 → 【】包裹", () => {
    expect(stripMarkdown("# 标题")).toBe("【标题】");
  });

  it("**粗体** 去除标记", () => {
    expect(stripMarkdown("这是 **重要** 内容")).toBe("这是 重要 内容");
  });

  it("链接 → 文本 (URL)", () => {
    expect(stripMarkdown("[谷歌](https://google.com)")).toBe("谷歌 (https://google.com)");
  });

  it("空字符串返回空", () => {
    expect(stripMarkdown("")).toBe("");
  });
});

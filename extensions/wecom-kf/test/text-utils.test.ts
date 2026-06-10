import { describe, it, expect } from "vitest";
import { stripMarkdown, splitMessageByBytes, prepareKfOutboundText } from "../src/outbound/text-utils.js";

describe("stripMarkdown", () => {
  it("should strip bold markers", () => {
    expect(stripMarkdown("**bold** text")).toBe("bold text");
  });

  it("should convert headers", () => {
    expect(stripMarkdown("# Title")).toBe("【Title】");
  });

  it("should convert code blocks", () => {
    const result = stripMarkdown("```js\nconst x = 1;\n```");
    expect(result).toContain("const x = 1;");
    expect(result).toContain("[js]");
  });

  it("should handle links", () => {
    expect(stripMarkdown("[text](https://example.com)")).toBe("text (https://example.com)");
  });

  it("should convert list items", () => {
    expect(stripMarkdown("- item")).toBe("· item");
  });

  it("should trim result", () => {
    expect(stripMarkdown("  hello  ")).toBe("hello");
  });
});

describe("splitMessageByBytes", () => {
  it("should not split short text", () => {
    expect(splitMessageByBytes("hello")).toEqual(["hello"]);
  });

  it("should split long text at byte boundary", () => {
    const long = "a".repeat(5000);
    const chunks = splitMessageByBytes(long, 2048);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(2048);
    });
  });

  it("should preserve character boundaries for CJK", () => {
    const cjk = "中".repeat(3000);
    const chunks = splitMessageByBytes(cjk, 2048);
    expect(chunks.length).toBeGreaterThan(1);
  });
});

describe("prepareKfOutboundText", () => {
  it("should strip markdown and split", () => {
    const result = prepareKfOutboundText("**hello** world");
    expect(result.length).toBe(1);
    expect(result[0]).toBe("hello world");
  });
});

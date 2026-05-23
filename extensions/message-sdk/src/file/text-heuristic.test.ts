import { describe, expect, it } from "vitest";

import {
  analyzeTextHeuristic,
  buildTextFilePreview,
  looksLikeTextFile,
  normalizeInboundTextContentType,
  previewHex,
} from "./text-heuristic.js";

describe("looksLikeTextFile", () => {
  it("returns true for plain UTF-8 text", () => {
    expect(looksLikeTextFile(Buffer.from("hello world\n"))).toBe(true);
  });

  it("returns false for binary-heavy buffer", () => {
    const binary = Buffer.alloc(100);
    for (let i = 0; i < binary.length; i++) binary[i] = i;
    expect(looksLikeTextFile(binary)).toBe(false);
  });
});

describe("buildTextFilePreview", () => {
  it("truncates long text previews", () => {
    const text = "a".repeat(20);
    const preview = buildTextFilePreview(Buffer.from(text), 10);
    expect(preview).toContain("…(已截断)");
  });
});

describe("normalizeInboundTextContentType", () => {
  it("promotes markdown extension to text/markdown", () => {
    expect(
      normalizeInboundTextContentType({
        contentType: "application/octet-stream",
        originalFileName: "readme.md",
        looksText: true,
      }),
    ).toBe("text/markdown");
  });

  it("promotes generic text to text/plain", () => {
    expect(
      normalizeInboundTextContentType({
        contentType: "application/octet-stream",
        originalFileName: "notes.txt",
        looksText: true,
      }),
    ).toBe("text/plain; charset=utf-8");
  });
});

describe("analyzeTextHeuristic / previewHex", () => {
  it("reports zero bad ratio for empty buffer", () => {
    expect(analyzeTextHeuristic(Buffer.alloc(0))).toEqual({
      sampleSize: 0,
      badCount: 0,
      badRatio: 0,
    });
  });

  it("formats hex preview", () => {
    expect(previewHex(Buffer.from([0x48, 0x69]))).toBe("48 69");
  });
});

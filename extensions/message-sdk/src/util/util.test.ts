import { describe, expect, it } from "vitest";
import { formatTemplate } from "./format-template.js";
import { splitUtf8TextByMaxBytes } from "./split-utf8-bytes.js";
import { truncateUtf8Bytes } from "./truncate-utf8-bytes.js";
import { withTimeout, AsyncTimeoutError } from "./async-timeout.js";

describe("formatTemplate", () => {
  it("replaces known placeholders", () => {
    expect(formatTemplate("hello {name}", { name: "world" })).toBe("hello world");
  });
});

describe("splitUtf8TextByMaxBytes", () => {
  it("returns empty array for empty input", () => {
    expect(splitUtf8TextByMaxBytes("", 2048)).toEqual([]);
  });

  it("returns single chunk when under limit", () => {
    expect(splitUtf8TextByMaxBytes("hello", 2048)).toEqual(["hello"]);
  });

  it("splits utf8 text without exceeding maxBytes per chunk", () => {
    const text = "中".repeat(500);
    const chunks = splitUtf8TextByMaxBytes(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(100);
    }
    expect(chunks.join("")).toBe(text);
  });

  it("preserves ascii boundaries", () => {
    const text = "a".repeat(10);
    expect(splitUtf8TextByMaxBytes(text, 3)).toEqual(["aaa", "aaa", "aaa", "a"]);
  });
});

describe("truncateUtf8Bytes", () => {
  it("preserves text under limit", () => {
    expect(truncateUtf8Bytes("hello", 100)).toBe("hello");
  });

  it("truncates from the head for utf8", () => {
    const long = "中".repeat(100);
    const result = truncateUtf8Bytes(long, 30);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(30);
  });
});

describe("withTimeout", () => {
  it("rejects on timeout", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 200));
    await expect(withTimeout(slow, 50, "slow")).rejects.toBeInstanceOf(AsyncTimeoutError);
  });
});

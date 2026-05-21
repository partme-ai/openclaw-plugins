import { describe, it, expect } from "vitest";
import {
  stripMarkdown,
  escapeMarkdownV2,
  convertToMrkdwn,
  splitText,
  stripAdvancedMarkdown,
  normalizeForChannel,
  getChannelNormalizer,
} from "./normalize.js";

describe("stripMarkdown", () => {
  it("removes bold markers", () => {
    expect(stripMarkdown("**hello**")).toBe("hello");
    expect(stripMarkdown("__hello__")).toBe("hello");
  });

  it("removes italic markers", () => {
    expect(stripMarkdown("*hello*")).toBe("hello");
    expect(stripMarkdown("_hello_")).toBe("hello");
  });

  it("removes code blocks", () => {
    expect(stripMarkdown("```js\nconst x = 1;\n```")).toBe("const x = 1;");
  });

  it("removes inline code", () => {
    expect(stripMarkdown("use `console.log` here")).toBe("use console.log here");
  });

  it("removes heading markers", () => {
    expect(stripMarkdown("# Title")).toBe("Title");
    expect(stripMarkdown("## Subtitle")).toBe("Subtitle");
  });

  it("removes link markup, keeps link text", () => {
    expect(stripMarkdown("[click here](https://example.com)")).toBe("click here");
  });

  it("removes image markup", () => {
    expect(stripMarkdown("![alt text](image.png)")).toBe("alt text");
  });

  it("removes strikethrough", () => {
    expect(stripMarkdown("~~deleted~~")).toBe("deleted");
  });

  it("removes blockquote markers", () => {
    expect(stripMarkdown("> quoted text")).toBe("quoted text");
  });

  it("preserves plain text", () => {
    expect(stripMarkdown("hello world")).toBe("hello world");
  });
});

describe("escapeMarkdownV2", () => {
  it("escapes Telegram MarkdownV2 special characters", () => {
    const input = "hello *world* _italic_ [link]";
    const escaped = escapeMarkdownV2(input);
    expect(escaped).toContain("\\*");
    expect(escaped).toContain("\\_");
    expect(escaped).toContain("\\[");
    expect(escaped).toContain("\\]");
  });

  it("escapes all required characters", () => {
    const special = "_*[]()~`>#+-=|{}.!";
    const escaped = escapeMarkdownV2(special);
    for (const ch of special) {
      expect(escaped).toContain(`\\${ch}`);
    }
  });
});

describe("convertToMrkdwn", () => {
  it("converts strikethrough to plain text", () => {
    expect(convertToMrkdwn("~~removed~~")).toBe("removed");
  });

  it("converts # heading to bold", () => {
    expect(convertToMrkdwn("# Title")).toBe("*Title*");
    expect(convertToMrkdwn("## Sub")).toBe("*Sub*");
  });

  it("preserves bold", () => {
    expect(convertToMrkdwn("**bold**")).toBe("**bold**");
  });
});

describe("splitText", () => {
  it("returns single segment for short text", () => {
    expect(splitText("hello", 100)).toEqual(["hello"]);
  });

  it("returns single segment for exact length", () => {
    const text = "a".repeat(10);
    expect(splitText(text, 10)).toEqual([text]);
  });

  it("splits at newline boundaries (preserving newlines)", () => {
    const text = "line1\nline2\nline3";
    const segments = splitText(text, 12);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    // Newlines should be at end of segments, not lost
    const joined = segments.join("");
    expect(joined).toBe(text);
  });

  it("splits at sentence boundaries when no newlines", () => {
    const text = "First sentence. Second sentence. Third sentence.";
    const segments = splitText(text, 25);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("splits at word boundaries as last resort", () => {
    const text = "word1 word2 word3 word4 word5";
    const segments = splitText(text, 15);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("handles empty string", () => {
    expect(splitText("", 10)).toEqual([]);
  });

  it("hard splits when no boundary found", () => {
    const text = "abcdefghij";
    const segments = splitText(text, 5);
    expect(segments).toEqual(["abcde", "fghij"]);
  });
});

describe("stripAdvancedMarkdown", () => {
  it("removes tables (leading-pipe lines)", () => {
    const input = "| a | b |\n|---|---|\n| 1 | 2 |";
    const result = stripAdvancedMarkdown(input);
    expect(result).not.toContain("|---");
    // Table rows with leading | get pipes stripped
    expect(result).not.toContain("| a |");
    expect(result).not.toContain("| 1 |");
  });

  it("preserves inline code with pipe (lines without leading pipe)", () => {
    const input = "Use `a | b` as input or a single | in text";
    const result = stripAdvancedMarkdown(input);
    // Lines without leading | that have pipes are left as-is
    expect(result).toContain("a | b");
  });

  it("removes footnotes", () => {
    const input = "Text[^1]\n[^1]: Footnote";
    const result = stripAdvancedMarkdown(input);
    expect(result).not.toContain("[^1]");
  });

  it("removes HTML tags", () => {
    const input = "Hello <b>world</b> <br/>";
    const result = stripAdvancedMarkdown(input);
    expect(result).not.toContain("<b>");
    expect(result).toContain("Hello");
  });

  it("keeps bold and italic", () => {
    const input = "**bold** and *italic*";
    const result = stripAdvancedMarkdown(input);
    expect(result).toContain("**bold**");
    expect(result).toContain("*italic*");
  });
});

describe("normalizeForChannel", () => {
  it("returns plain text for signal (no markdown)", () => {
    const result = normalizeForChannel("signal", "**hello** world");
    expect(result.contentType).toBe("text");
    expect(result.segments[0]).not.toContain("**");
    expect(result.segments[0]).toContain("hello");
  });

  it("returns plain text for whatsapp", () => {
    const result = normalizeForChannel("whatsapp", "**hello**");
    expect(result.contentType).toBe("text");
    expect(result.segments[0]).not.toContain("**");
  });

  it("returns plain text for irc with short segments", () => {
    const result = normalizeForChannel("irc", "hello world");
    expect(result.contentType).toBe("text");
    expect(result.segments.length).toBeGreaterThanOrEqual(1);
  });

  it("returns markdown for discord", () => {
    const result = normalizeForChannel("discord", "**hello**");
    expect(result.contentType).toBe("markdown");
    expect(result.segments[0]).toContain("**hello**");
  });

  it("returns plain text for twitch, truncated at 500", () => {
    const longText = "a".repeat(600);
    const result = normalizeForChannel("twitch", longText);
    expect(result.contentType).toBe("text");
    expect(result.segments[0]!.length).toBe(500);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("returns markdown for matrix", () => {
    const result = normalizeForChannel("matrix", "# Title\n**bold**");
    expect(result.contentType).toBe("markdown");
  });

  it("handles unknown channelId gracefully (returns content as-is)", () => {
    const result = normalizeForChannel("nonexistent", "hello");
    expect(result.segments).toEqual(["hello"]);
    expect(result.warnings).toEqual([]);
  });

  it("splits long content for dingtalk (4000 chars)", () => {
    const longText = "a".repeat(5000);
    const result = normalizeForChannel("dingtalk-connector", longText);
    expect(result.segments.length).toBeGreaterThan(1);
    for (const seg of result.segments) {
      expect(seg.length).toBeLessThanOrEqual(4000);
    }
  });

  it("splits long content for wecom (2048 chars)", () => {
    const longText = "a".repeat(3000);
    const result = normalizeForChannel("wecom", longText);
    expect(result.segments.length).toBeGreaterThan(1);
    for (const seg of result.segments) {
      expect(seg.length).toBeLessThanOrEqual(2048);
    }
  });

  it("produces warnings when content was modified", () => {
    const longText = "a".repeat(5000);
    const result = normalizeForChannel("discord", longText);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

describe("getChannelNormalizer", () => {
  it("returns normalizer for known channel", () => {
    const norm = getChannelNormalizer("discord");
    expect(norm).toBeDefined();
    expect(norm!.maxLen).toBe(2000);
    expect(norm!.overflowStrategy).toBe("split");
  });

  it("returns undefined for unknown channel", () => {
    expect(getChannelNormalizer("nonexistent")).toBeUndefined();
  });
});

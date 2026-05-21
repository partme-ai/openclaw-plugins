import { describe, it, expect } from "vitest";
import { PRESETS } from "./presets.js";
import { ALL_CHANNELS } from "./channels.js";
import type { ChannelContextPreset } from "./channels.js";

describe("Context Presets completeness", () => {
  it("has exactly one preset per channel", () => {
    const presetKeys = Object.keys(PRESETS);
    const channelPresets = ALL_CHANNELS.map((c) => c.contextPreset);
    expect(presetKeys.sort()).toEqual([...new Set(channelPresets)].sort());
  });

  it("every preset is a non-empty string", () => {
    for (const [key, value] of Object.entries(PRESETS)) {
      expect(typeof value, `Preset "${key}" is not a string`).toBe("string");
      expect(value.length, `Preset "${key}" is empty`).toBeGreaterThan(0);
    }
  });

  it("no preset contains 'generic' or '通用'", () => {
    for (const [key, value] of Object.entries(PRESETS)) {
      expect(value, `Preset "${key}" contains "generic"`).not.toContain("generic");
      expect(value, `Preset "${key}" contains "通用"`).not.toContain("通用");
    }
  });

  it("every preset mentions at least one capability or rule", () => {
    for (const [key, value] of Object.entries(PRESETS)) {
      // Presets should have bullet points (-)
      expect(value, `Preset "${key}" has no rules`).toContain("-");
    }
  });

  it("every preset starts with platform intro line", () => {
    for (const [key, value] of Object.entries(PRESETS)) {
      expect(value, `Preset "${key}" doesn't start with platform intro`).toContain("你正在通过");
    }
  });
});

describe("Specific preset content", () => {
  it("dingtalk preset mentions 4000 character limit", () => {
    expect(PRESETS.dingtalk).toContain("4000");
  });

  it("discord preset mentions 2000 character limit", () => {
    expect(PRESETS.discord).toContain("2000");
  });

  it("telegram preset mentions 4096 character limit", () => {
    expect(PRESETS.telegram).toContain("4096");
  });

  it("irc preset mentions character limit", () => {
    expect(PRESETS.irc).toContain("400");
  });

  it("twitch preset mentions 500 character limit", () => {
    expect(PRESETS.twitch).toContain("500");
  });

  it("signal preset mentions end-to-end encryption", () => {
    expect(PRESETS.signal).toContain("加密");
  });

  it("wecom preset mentions MEDIA: directive", () => {
    expect(PRESETS.wecom).toContain("MEDIA:");
  });

  it("slack preset mentions Block Kit", () => {
    expect(PRESETS.slack).toContain("Block Kit");
  });

  it("lark preset mentions 50+ tools", () => {
    expect(PRESETS.lark).toContain("50+");
  });
});

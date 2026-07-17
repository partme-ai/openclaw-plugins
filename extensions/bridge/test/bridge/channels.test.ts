import { describe, it, expect } from "vitest";
import {
  ALL_CHANNELS,
  getChannelMeta,
  getExternalChannels,
  getBundledChannels,
  type ChannelMeta,
} from "../../src/bridge/channels.js";

describe("ALL_CHANNELS registry", () => {
  it("registers stock, external, and repository channels", () => {
    expect(ALL_CHANNELS).toHaveLength(27);
  });

  it("every channel has required fields", () => {
    for (const ch of ALL_CHANNELS) {
      expect(ch.channelId).toBeTruthy();
      expect(ch.label).toBeTruthy();
      expect(ch.labelCN).toBeTruthy();
      expect(ch.source).toMatch(/^(external|openclaw-stock|repository)$/);
      expect(ch.contextPreset).toBeTruthy();
    }
  });

  it("seven channels require non-stock plugins", () => {
    expect(getExternalChannels()).toHaveLength(7);
  });

  it("20 channels are OpenClaw 2026.7.1 stock channels", () => {
    expect(getBundledChannels()).toHaveLength(20);
  });

  it("every channel has a unique channelId", () => {
    const ids = ALL_CHANNELS.map((c) => c.channelId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every contextPreset is a known preset key (no generic fallbacks)", () => {
    const validPresets = new Set(ALL_CHANNELS.map((c) => c.contextPreset));
    // Should not have generic presets
    expect(validPresets.has("generic-chat" as never)).toBe(false);
    expect(validPresets.has("generic-social" as never)).toBe(false);
    // Every preset should be unique per channel
    const presetValues = ALL_CHANNELS.map((c) => c.contextPreset);
    expect(new Set(presetValues).size).toBe(presetValues.length);
  });

  it("external channels have npmPackage and repoUrl", () => {
    for (const ch of getExternalChannels()) {
      expect(ch.npmPackage).toBeTruthy();
      expect(ch.repoUrl).toBeTruthy();
    }
  });

  it("union of external + bundled equals ALL_CHANNELS", () => {
    const external = getExternalChannels();
    const bundled = getBundledChannels();
    expect(external.length + bundled.length).toBe(ALL_CHANNELS.length);
  });
});

describe("getChannelMeta", () => {
  it("returns meta for known channelId", () => {
    const meta = getChannelMeta("discord");
    expect(meta).toBeDefined();
    expect(meta!.channelId).toBe("discord");
    expect(meta!.label).toBe("Discord");
  });

  it("returns meta for external channel", () => {
    const meta = getChannelMeta("dingtalk-connector");
    expect(meta).toBeDefined();
    expect(meta!.source).toBe("external");
  });

  it("returns undefined for unknown channelId", () => {
    expect(getChannelMeta("nonexistent")).toBeUndefined();
  });

  it("is case-sensitive", () => {
    expect(getChannelMeta("Discord")).toBeUndefined();
    expect(getChannelMeta("DISCORD")).toBeUndefined();
  });
});

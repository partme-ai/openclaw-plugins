import { describe, it, expect } from "vitest";
import {
  ALL_CHANNELS,
  getChannelMeta,
  getExternalChannels,
  getBundledChannels,
  type ChannelMeta,
  resolveChannelAvailability,
  adaptGatewayChannelFacts,
} from "../../src/bridge/channels.js";

describe("2026.9.6 Gateway channel facts", () => {
  const mqtt = getChannelMeta("mqtt");
  const snapshots = (account: Record<string, unknown>) => ({
    channelAccounts: { mqtt: [{ accountId: "default", ...account }] },
  });

  it("keeps a catalog entry known while an explicit host manifest says absent", () => {
    expect(resolveChannelAvailability(mqtt, { installed: false })).toEqual({
      known: true, installed: false, enabled: false, ready: false,
      unavailableFacts: ["enabled", "ready"],
    });
    expect(resolveChannelAvailability({ ...mqtt! }, { installed: false }).known).toBe(true);
  });

  it("separates disabled and disconnected runtime states", () => {
    const disabled = adaptGatewayChannelFacts(mqtt!,
      { plugins: [{ id: "mqtt", installed: true, enabled: false, runtime: { state: "disabled" } }] },
      snapshots({ enabled: false, configured: true, running: false }));
    expect(resolveChannelAvailability(mqtt, disabled)).toMatchObject({ known: true, installed: true, enabled: false, ready: false });
    const disconnected = adaptGatewayChannelFacts(mqtt!,
      { plugins: [{ id: "mqtt", installed: true, enabled: true, runtime: { state: "active" } }] },
      snapshots({ enabled: true, configured: true, running: false }));
    expect(resolveChannelAvailability(mqtt, disconnected)).toMatchObject({ known: true, installed: true, enabled: true, ready: false });
    const recovered = adaptGatewayChannelFacts(mqtt!,
      { plugins: [{ id: "mqtt", installed: true, enabled: true, runtime: { state: "active" } }] },
      snapshots({ enabled: true, configured: true, running: true }));
    expect(resolveChannelAvailability(mqtt, recovered)).toMatchObject({ known: true, installed: true, enabled: true, ready: true });
  });

  it("fails closed for partial snapshots, service failure, and unknown channels", () => {
    const partial = adaptGatewayChannelFacts(mqtt!, { plugins: [] }, { channelAccounts: {} });
    expect(resolveChannelAvailability(mqtt, partial).unavailableFacts).toEqual(["installed", "enabled", "ready"]);
    const incomplete = adaptGatewayChannelFacts(mqtt!,
      { plugins: [{ id: "mqtt", installed: true, enabled: true, runtime: { state: "active" } }] },
      { ...snapshots({ enabled: true, configured: true, running: true }), partial: true });
    expect(resolveChannelAvailability(mqtt, incomplete).unavailableFacts).toContain("ready");
    const incompletePlugins = adaptGatewayChannelFacts(mqtt!,
      { partial: true, plugins: [{ id: "mqtt", installed: true, enabled: true, runtime: { state: "active" } }] },
      snapshots({ enabled: true, configured: true, running: true }));
    expect(resolveChannelAvailability(mqtt, incompletePlugins).unavailableFacts).toEqual(["installed", "enabled", "ready"]);
    const failed = adaptGatewayChannelFacts(mqtt!,
      { plugins: [{ id: "mqtt", installed: true, enabled: true, runtime: { state: "service-failed" } }] },
      snapshots({ enabled: true, configured: true, running: true }));
    expect(resolveChannelAvailability(mqtt, failed).ready).toBe(false);
    expect(resolveChannelAvailability(undefined, { installed: true, enabled: true, ready: true })).toEqual({
      known: false, installed: false, enabled: false, ready: false,
    });
  });

  it("maps the 2026.9.6 downloadable QQ plugin id to its channel id", () => {
    const qqbot = getChannelMeta("qqbot");
    expect(qqbot?.hostPluginId).toBe("openclaw-qqbot");
    const facts = adaptGatewayChannelFacts(qqbot!,
      { plugins: [{ id: "openclaw-qqbot", installed: false, enabled: false, runtime: { state: "unloaded" } }] },
      { channelAccounts: {} });
    expect(resolveChannelAvailability(qqbot, facts).installed).toBe(false);
  });

  it("does not let caller metadata borrow another plugin's host facts", () => {
    const spoofed = { ...mqtt!, hostPluginId: "other-plugin" };
    const plugins = { plugins: [
      { id: "mqtt", installed: false, enabled: false, runtime: { state: "unloaded" } },
      { id: "other-plugin", installed: true, enabled: true, runtime: { state: "active" } },
    ] };
    expect(adaptGatewayChannelFacts(spoofed, plugins, { channelAccounts: {} }).installed).toBe(false);
    expect(adaptGatewayChannelFacts({ ...spoofed, channelId: "not-in-catalog" }, plugins, { channelAccounts: {} })).toEqual({});
  });

  it("pins the bundled channel IDs to the OpenClaw 2026.9.6 manifests", () => {
    expect(getBundledChannels().map((channel) => channel.channelId).sort()).toEqual([
      "discord", "feishu", "googlechat", "imessage", "irc", "line", "matrix",
      "mattermost", "msteams", "nextcloud-talk", "nostr", "signal", "slack",
      "synology-chat", "telegram", "tlon", "twitch", "whatsapp", "zalo",
    ].sort());
  });
});

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

  it("eight channels require non-bundled plugins in 2026.9.6", () => {
    expect(getExternalChannels()).toHaveLength(8);
  });

  it("19 channels have a bundled 2026.9.6 manifest", () => {
    expect(getBundledChannels()).toHaveLength(19);
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

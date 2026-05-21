import { describe, it, expect } from "vitest";
import {
  ALL_CAPABILITIES,
  getChannelCapabilities,
  type ChannelCapabilities,
} from "./capabilities.js";
import { ALL_CHANNELS } from "./channels.js";

describe("ALL_CAPABILITIES coverage", () => {
  it("every channel in ALL_CHANNELS has a capability declaration", () => {
    for (const ch of ALL_CHANNELS) {
      expect(ALL_CAPABILITIES[ch.channelId], `Missing capability for ${ch.channelId}`).toBeDefined();
    }
  });

  it("capabilities channelId matches registry channelId", () => {
    for (const ch of ALL_CHANNELS) {
      const cap = ALL_CAPABILITIES[ch.channelId];
      expect(cap!.channelId).toBe(ch.channelId);
    }
  });

  it("no extra capabilities beyond registered channels", () => {
    const registeredIds = new Set(ALL_CHANNELS.map((c) => c.channelId));
    for (const capId of Object.keys(ALL_CAPABILITIES)) {
      expect(registeredIds.has(capId), `Extra capability: ${capId}`).toBe(true);
    }
  });
});

describe("ChannelCapabilities schema validation", () => {
  const allCaps = Object.values(ALL_CAPABILITIES);

  it("supportedFormats is non-empty for every channel", () => {
    for (const cap of allCaps) {
      expect(cap.supportedFormats.length, `${cap.channelId} has no formats`).toBeGreaterThan(0);
    }
  });

  it("media.maxFileSizeBytes is >= 0", () => {
    for (const cap of allCaps) {
      expect(cap.media.maxFileSizeBytes).toBeGreaterThanOrEqual(0);
    }
  });

  it("textLimits.maxPerMessage is > 0", () => {
    for (const cap of allCaps) {
      expect(cap.textLimits.maxPerMessage, `${cap.channelId} maxPerMessage <= 0`).toBeGreaterThan(0);
    }
  });

  it("overflowStrategy is one of truncate|split|error", () => {
    for (const cap of allCaps) {
      expect(["truncate", "split", "error"]).toContain(cap.textLimits.overflowStrategy);
    }
  });

  it("escaping.markdownDialect is one of the allowed values", () => {
    const valid = ["none", "basic", "github", "markdown-v2", "mrkdwn", "commonmark", "html"];
    for (const cap of allCaps) {
      expect(valid, `${cap.channelId} has invalid dialect: ${cap.escaping.markdownDialect}`).toContain(cap.escaping.markdownDialect);
    }
  });

  it("channels with no media support have empty outbound arrays", () => {
    const noMedia = ["irc", "twitch"];
    for (const id of noMedia) {
      const cap = ALL_CAPABILITIES[id];
      expect(cap!.media.outbound).toHaveLength(0);
      expect(cap!.media.inbound).toHaveLength(0);
    }
  });
});

describe("Known channel limits", () => {
  it("IRC has maxPerMessage <= 512", () => {
    expect(ALL_CAPABILITIES["irc"]!.textLimits.maxPerMessage).toBeLessThanOrEqual(512);
  });

  it("Discord has maxPerMessage 2000", () => {
    expect(ALL_CAPABILITIES["discord"]!.textLimits.maxPerMessage).toBe(2000);
  });

  it("Telegram has maxPerMessage 4096", () => {
    expect(ALL_CAPABILITIES["telegram"]!.textLimits.maxPerMessage).toBe(4096);
  });

  it("Twitch has overflowStrategy truncate", () => {
    expect(ALL_CAPABILITIES["twitch"]!.textLimits.overflowStrategy).toBe("truncate");
  });

  it("Twitch has maxPerMessage 500", () => {
    expect(ALL_CAPABILITIES["twitch"]!.textLimits.maxPerMessage).toBe(500);
  });

  it("WeCom uses basic markdown dialect", () => {
    expect(ALL_CAPABILITIES["wecom"]!.escaping.markdownDialect).toBe("basic");
  });

  it("Slack uses mrkdwn dialect", () => {
    expect(ALL_CAPABILITIES["slack"]!.escaping.markdownDialect).toBe("mrkdwn");
  });

  it("Telegram uses markdown-v2 dialect", () => {
    expect(ALL_CAPABILITIES["telegram"]!.escaping.markdownDialect).toBe("markdown-v2");
  });

  it("Telegram supports sticker media", () => {
    expect(ALL_CAPABILITIES["telegram"]!.media.outbound).toContain("sticker");
  });
});

describe("getChannelCapabilities", () => {
  it("returns capabilities for known channel", () => {
    const cap = getChannelCapabilities("discord");
    expect(cap).toBeDefined();
    expect(cap!.channelId).toBe("discord");
  });

  it("returns undefined for unknown channel", () => {
    expect(getChannelCapabilities("nonexistent")).toBeUndefined();
  });
});

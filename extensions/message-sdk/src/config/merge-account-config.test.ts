import { describe, expect, it } from "vitest";
import { mergeChannelAccountConfig } from "./merge-account-config.js";

describe("mergeChannelAccountConfig", () => {
  it("shallow merges scalar fields", () => {
    const merged = mergeChannelAccountConfig(
      { botId: "a", secret: "s" },
      { secret: "s2" },
    );
    expect(merged).toEqual({ botId: "a", secret: "s2" });
  });

  it("deep merges templates and groups", () => {
    const merged = mergeChannelAccountConfig(
      {
        templates: { thinking: "base" },
        groups: { g1: { enabled: true } },
      },
      {
        templates: { tool: "custom" },
        groups: { g2: { enabled: false } },
      },
      ["templates", "groups"],
    );
    expect(merged.templates).toEqual({ thinking: "base", tool: "custom" });
    expect(merged.groups).toEqual({
      g1: { enabled: true },
      g2: { enabled: false },
    });
  });
});

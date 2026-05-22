import { describe, expect, it } from "vitest";
import {
  isChatChannelPluginFactoryAvailable,
  resolveWecomChannelPlugin,
} from "./channel-factory.js";

describe("channel-factory", () => {
  it("resolveWecomChannelPlugin returns wecom plugin", () => {
    const plugin = resolveWecomChannelPlugin();
    expect(plugin.id).toBe("wecom");
  });

  it("isChatChannelPluginFactoryAvailable resolves boolean", async () => {
    const available = await isChatChannelPluginFactoryAvailable();
    expect(typeof available).toBe("boolean");
  });
});

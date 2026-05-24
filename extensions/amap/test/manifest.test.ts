/**
 * Amap outbound and plugin entry smoke tests.
 */
import { describe, expect, it, vi } from "vitest";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import {
  createManifestSmokeTests,
  pluginRootFromTestFile,
} from "../../../test-utils/plugin-manifest.js";

import plugin, { amapChannel } from "../src/index.js";
import { amapSendText } from "../src/outbound.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "amap",
  requireChannels: true,
});

describe("amap outbound", () => {
  it("sendText stub always returns ok", async () => {
    const result = await amapSendText({ text: "hello", to: "poi-1" });
    expect(result.ok).toBe(true);
  });
});

describe("amap plugin entry", () => {
  it("exports amap channel plugin id", () => {
    expect(plugin.id).toBe("amap");
    expect(amapChannel.id).toBe("amap");
  });

  it("register registers webhook route and tools in full mode", () => {
    const registerHttpRoute = vi.fn();
    const api = createMockPluginApi({
      config: { channels: { amap: { key: "k" } } },
      registerHttpRoute,
      registrationMode: "full",
    });
    plugin.register(api as never);
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/channels/amap/webhook" }),
    );
    expect(api.registerTool).toHaveBeenCalled();
  });
});

/**
 * Meituan plugin manifest and entry smoke tests.
 */
import { describe, expect, it, vi } from "vitest";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import {
  createManifestSmokeTests,
  pluginRootFromTestFile,
} from "../../../test-utils/plugin-manifest.js";

import plugin, { meituanChannel } from "../src/index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "meituan",
  requireChannels: true,
});

describe("meituan plugin entry", () => {
  it("exports meituan channel plugin id", () => {
    expect(plugin.id).toBe("meituan");
    expect(meituanChannel.id).toBe("meituan");
  });

  it("register registers webhook route and tools in full mode", () => {
    const registerHttpRoute = vi.fn();
    const api = createMockPluginApi({
      config: { channels: { meituan: { app_key: "k", app_secret: "s" } } },
      registerHttpRoute,
      registrationMode: "full",
    });
    plugin.register(api as never);
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/channels/meituan/webhook" }),
    );
    expect(api.registerTool).toHaveBeenCalled();
  });
});

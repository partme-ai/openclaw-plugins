/**
 * Rednode plugin manifest and entry smoke tests.
 */
import { describe, expect, it, vi } from "vitest";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import {
  createManifestSmokeTests,
  pluginRootFromTestFile,
} from "../../../test-utils/plugin-manifest.js";

import plugin, { xhsChannel } from "../src/index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "rednode",
  requireChannels: true,
});

describe("rednode plugin entry", () => {
  it("exports rednode plugin id while channel id is xhs", () => {
    expect(plugin.id).toBe("rednode");
    expect(xhsChannel.id).toBe("xhs");
  });

  it("register registers webhook route and tools in full mode", () => {
    const registerHttpRoute = vi.fn();
    const api = createMockPluginApi({
      config: { channels: { xhs: { app_key: "k", app_secret: "s" } } },
      registerHttpRoute,
      registrationMode: "full",
    });
    plugin.register(api as never);
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/channels/xhs/webhook" }),
    );
    expect(api.registerTool).toHaveBeenCalled();
  });
});

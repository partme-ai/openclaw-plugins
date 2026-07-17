import { describe, expect, it, vi } from "vitest";
import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createManifestSmokeTests, pluginRootFromTestFile } from "../../../test-utils/plugin-manifest.js";
import plugin from "../src/index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "amap",
  requireChannels: false,
});

describe("amap plugin entry", () => {
  it("registers only tools when enabled", () => {
    const registerHttpRoute = vi.fn();
    const api = createMockPluginApi({ registerHttpRoute });
    (api as any).pluginConfig = { enabled: true, key: "test" };
    (api as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    plugin.register(api as never);
    expect(api.registerTool).toHaveBeenCalledTimes(3);
    expect(registerHttpRoute).not.toHaveBeenCalled();
  });
});

/**
 * Douyin plugin manifest and entry smoke tests.
 */
import { describe, expect, it } from "vitest";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import {
  createManifestSmokeTests,
  pluginRootFromTestFile,
} from "../../../test-utils/plugin-manifest.js";

import plugin, { douyinChannelPlugin, setDouyinRuntime } from "../src/index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "douyin",
  requireChannels: true,
});

describe("douyin plugin entry", () => {
  it("exports douyin channel plugin id", () => {
    expect(plugin.id).toBe("douyin");
    expect(plugin.name).toBe("抖音");
  });

  it("registers channel plugin with douyin id", () => {
    expect(douyinChannelPlugin.id).toBe("douyin");
  });

  it("registerFull registers douyin tools when api supports registerTool", () => {
    setDouyinRuntime({
      config: {
        loadConfig: () => ({
          channels: { douyin: { app_key: "k", app_secret: "s" } },
        }),
      },
    } as never);

    const api = createMockPluginApi({
      config: {
        channels: {
          douyin: { app_key: "k", app_secret: "s" },
        },
      },
      registrationMode: "full",
    });
    plugin.register(api as never);
    expect(api.registerTool).toHaveBeenCalled();
  });
});

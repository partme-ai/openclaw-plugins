/**
 * Douyin plugin manifest and entry smoke tests.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  it("keeps channel schema aligned with all runtime-supported channel fields", () => {
    const root = pluginRootFromTestFile(import.meta.url);
    const manifest = JSON.parse(readFileSync(join(root, "openclaw.plugin.json"), "utf8"));
    const pluginFields = manifest.configSchema.properties;
    const channelFields = manifest.channelConfigs.douyin.schema.properties;

    // OpenClaw 2026.7.1 对 channels.douyin 使用 channelConfigs 校验；字段漂移会让
    // 运行时明明支持的配置在安装/启动前就被拒绝。
    expect(Object.keys(channelFields).sort()).toEqual(Object.keys(pluginFields).sort());
    expect(Object.keys(channelFields.accounts.additionalProperties.properties).sort()).toEqual(
      Object.keys(pluginFields.accounts.additionalProperties.properties).sort(),
    );
  });

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
    const registerHttpRoute = vi.fn();
    Object.assign(api, { registerHttpRoute });
    plugin.register(api as never);
    expect(api.registerTool).toHaveBeenCalled();
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/douyin/status", auth: "gateway", match: "exact" }),
    );
    expect(registerHttpRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/douyin/replay-dead-letters",
        auth: "gateway",
        match: "exact",
      }),
    );
  });
});

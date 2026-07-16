import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createManifestSmokeTests, pluginRootFromTestFile } from "../../../test-utils/plugin-manifest.js";
import plugin from "../src/index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), {
  expectedId: "meituan",
  requireChannels: false,
});

describe("meituan plugin entry", () => {
  it("declares the registered tool contract", () => {
    const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
    expect(manifest.contracts.tools).toEqual(["meituan_openapi_invoke"]);
  });

  it("registers one tool and no channel or route when enabled", () => {
    const registerHttpRoute = vi.fn();
    const registerChannel = vi.fn();
    const api = createMockPluginApi({ registerHttpRoute, registerChannel });
    (api as any).pluginConfig = {
      enabled: true,
      developerId: "123",
      signKey: "key",
      operations: [{ name: "query", apiPath: "/query", businessId: 1, requiresAuth: false }],
    };
    (api as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    plugin.register(api as never);
    expect(api.registerTool).toHaveBeenCalledTimes(1);
    expect(registerChannel).not.toHaveBeenCalled();
    expect(registerHttpRoute).not.toHaveBeenCalled();
  });
});

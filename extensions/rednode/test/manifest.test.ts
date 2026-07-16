import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createManifestSmokeTests, pluginRootFromTestFile } from "../../../test-utils/plugin-manifest.js";
import plugin from "../src/index.js";

createManifestSmokeTests(pluginRootFromTestFile(import.meta.url), { expectedId: "rednode", requireChannels: false });

describe("rednode plugin", () => {
  it("declares and registers one tool without channel or routes", () => {
    const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
    expect(manifest.contracts.tools).toEqual(["rednode_ark_invoke"]);
    const registerHttpRoute = vi.fn();
    const registerChannel = vi.fn();
    const api = createMockPluginApi({ registerHttpRoute, registerChannel });
    (api as any).pluginConfig = { enabled: true, appKey: "a", appSecret: "s", operations: [{ name: "items", method: "GET", apiPath: "/ark/open_api/v1/items" }] };
    (api as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    plugin.register(api as never);
    expect(api.registerTool).toHaveBeenCalledTimes(1);
    expect(registerHttpRoute).not.toHaveBeenCalled();
    expect(registerChannel).not.toHaveBeenCalled();
  });
});

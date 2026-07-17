import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import plugin from "../src/index.js";
import { WEBHOOK_PATHS } from "../src/types/constants.js";

function createMockApi(config: OpenClawConfig = { channels: {} }) {
  const registerChannel = vi.fn();
  const registerHttpRoute = vi.fn();
  const registerTool = vi.fn();
  const registerService = vi.fn();
  const on = vi.fn();
  const api = {
    runtime: { config: { current: () => config } },
    registerChannel,
    registerHttpRoute,
    registerTool,
    registerService,
    on,
  } as unknown as OpenClawPluginApi;
  return { api, registerChannel, registerHttpRoute, registerTool, registerService, on };
}

describe("wecom-kf plugin register", () => {
  it("registers KF callback routes with dynamic webhookPath", () => {
    const { api, registerChannel, registerHttpRoute } = createMockApi({
      channels: {
        "wecom-kf": {
          webhookPath: "/custom/kf",
          accounts: {
            desk2: { webhookPath: "/kf/desk2" },
          },
        },
      },
    } as OpenClawConfig);

    plugin.register(api);

    expect(registerChannel).toHaveBeenCalledTimes(1);

    const registeredPaths = registerHttpRoute.mock.calls.map(
      (call) => (call[0] as { path: string }).path,
    );

    expect(registeredPaths).toContain("/custom/kf");
    expect(registeredPaths).toContain("/kf/desk2");
    expect(registeredPaths).toContain(WEBHOOK_PATHS.KF);
    expect(registeredPaths).toContain("/plugins/wecom-kf");
    expect(registerHttpRoute.mock.calls.every((call) => call[0].match === "exact")).toBe(true);
  });

  it("registers durable state initialization as an awaited service", async () => {
    const { api, registerService } = createMockApi();
    plugin.register(api);
    expect(registerService).toHaveBeenCalledWith(expect.objectContaining({
      id: "wecom-kf-state",
      start: expect.any(Function),
      stop: expect.any(Function),
    }));
    await expect(registerService.mock.calls[0][0].start()).resolves.toBeUndefined();
    await expect(registerService.mock.calls[0][0].stop()).resolves.toBeUndefined();
  });

  it("does not register the removed legacy MCP bridge", () => {
    const { api, registerTool } = createMockApi();

    plugin.register(api);

    expect(registerTool.mock.calls.some((call) => call[1]?.name === "wecom_kf_mcp")).toBe(false);
  });

  it("registers wecom_kf control tools with isolated naming", () => {
    const { api, registerTool } = createMockApi();

    plugin.register(api);

    const toolNames = registerTool.mock.calls.map((call) => (call[1] as { name: string }).name);
    expect(toolNames).toContain("wecom_kf_list_servicers");
    expect(toolNames).toContain("wecom_kf_list_accounts");
    expect(toolNames).toContain("wecom_kf_get_account_link");
    expect(toolNames).toContain("wecom_kf_transfer_session");
    expect(toolNames).not.toContain("wecom_kf_servicer_list");
    expect(toolNames).not.toContain("wecom_kf_session_transfer");
  });

  it("injects MEDIA prompt only for wecom-kf channel via before_prompt_build", () => {
    const { api, on } = createMockApi();
    plugin.register(api);

    const mediaHandler = on.mock.calls
      .filter((call) => call[0] === "before_prompt_build")
      .map((call) => call[1])
      .find((handler) => {
        const result = handler({}, { channelId: "wecom-kf" });
        if (result && typeof (result as Promise<unknown>).then === "function") {
          return false;
        }
        return (result as { systemPrompt?: string } | undefined)?.systemPrompt?.includes("MEDIA:");
      });
    expect(mediaHandler).toBeTypeOf("function");

    expect(mediaHandler!({}, { channelId: "telegram" })).toBeUndefined();

    const result = mediaHandler!({}, { channelId: "wecom-kf" });
    expect(result).toBeDefined();
    expect(result.systemPrompt).toContain("MEDIA:");
  });
});

import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import plugin from "./index.js";
import { WEBHOOK_PATHS } from "./src/types/constants.js";

function createMockApi(config: OpenClawConfig = { channels: {} }) {
  const registerChannel = vi.fn();
  const registerHttpRoute = vi.fn();
  const registerTool = vi.fn();
  const on = vi.fn();
  const api = {
    runtime: { config },
    registerChannel,
    registerHttpRoute,
    registerTool,
    on,
  } as unknown as OpenClawPluginApi;
  return { api, registerChannel, registerHttpRoute, registerTool, on };
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
    expect(registeredPaths).not.toContain(WEBHOOK_PATHS.BOT_PLUGIN);
  });

  it("registers legacy wecom-cs routes only when legacyWecomCsEnabled=true", () => {
    const { api, registerHttpRoute } = createMockApi({
      channels: {
        "wecom-kf": {
          legacyWecomCsEnabled: true,
        },
      },
    } as OpenClawConfig);

    plugin.register(api);

    const registeredPaths = registerHttpRoute.mock.calls.map(
      (call) => (call[0] as { path: string }).path,
    );

    expect(registeredPaths).toContain(WEBHOOK_PATHS.BOT_PLUGIN);
    expect(registeredPaths).toContain(WEBHOOK_PATHS.AGENT_PLUGIN);

    const kfRoute = registerHttpRoute.mock.calls.find(
      (call) => (call[0] as { path: string }).path === WEBHOOK_PATHS.KF,
    );
    const csBotRoute = registerHttpRoute.mock.calls.find(
      (call) => (call[0] as { path: string }).path === WEBHOOK_PATHS.BOT_PLUGIN,
    );
    expect(kfRoute?.[0].handler).not.toBe(csBotRoute?.[0].handler);
  });

  it("registers wecom_kf_mcp tool", () => {
    const { api, registerTool } = createMockApi();

    plugin.register(api);

    expect(registerTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: "wecom_kf_mcp" }),
    );
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

  it("registers ICS routes only when icsEnabled=true", () => {
    const { api, registerHttpRoute } = createMockApi({
      channels: { "wecom-kf": { icsEnabled: true } },
    } as OpenClawConfig);

    plugin.register(api);

    const registeredPaths = registerHttpRoute.mock.calls.map(
      (call) => (call[0] as { path: string }).path,
    );
    expect(registeredPaths).toContain("/ics/agents");
    expect(registeredPaths).toContain("/ics/config/bindings");
  });

  it("does not register ICS routes by default", () => {
    const { api, registerHttpRoute } = createMockApi();

    plugin.register(api);

    const registeredPaths = registerHttpRoute.mock.calls.map(
      (call) => (call[0] as { path: string }).path,
    );
    expect(registeredPaths).not.toContain("/ics/agents");
    expect(registeredPaths).not.toContain("/ics/stats/overview");
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

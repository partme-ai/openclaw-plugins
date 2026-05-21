import { describe, expect, it } from "vitest";
import plugin from "./index.js";

function registerPluginAndCollectRoutes(config?: {
  mode?: "webhook" | "ws";
  webhookPath?: string;
  accounts?: Record<string, { mode?: "webhook" | "ws"; webhookPath?: string }>;
}): string[] {
  const routes: { path: string; auth: string; match?: string; handler: unknown }[] = [];

  plugin.register({
    registerChannel: () => {},
    registerTool: () => {},
    registerHttpRoute: (params: { path: string; auth: string; match?: string; handler: unknown }) => {
      routes.push(params);
    },
    on: () => {},
    config: {
      channels: {
        wecom: config as Record<string, unknown>,
      },
    },
    runtime: {} as Record<string, unknown>,
    logger: {
      info: () => {},
      debug: () => {},
      error: () => {},
    },
  } as any);

  return routes.map((r) => r.path).sort((a, b) => a.localeCompare(b));
}

describe("wecom plugin", () => {
  it("has correct plugin id", () => {
    expect(plugin.id).toBe("wecom");
  });

  it("has configSchema", () => {
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.configSchema.type).toBe("object");
  });
});

describe("wecom plugin route registration", () => {
  it("registers agent routes", () => {
    const routes = registerPluginAndCollectRoutes();
    const agentRoutes = routes.filter((r) => r.startsWith("/wecom/agent") || r.startsWith("/plugins/wecom/agent"));
    expect(agentRoutes.length).toBeGreaterThanOrEqual(2);
  });

  it("registers bot routes", () => {
    const routes = registerPluginAndCollectRoutes();
    const botRoutes = routes.filter((r) =>
      r === "/wecom" || r === "/wecom/bot" || r === "/plugins/wecom/bot"
    );
    expect(botRoutes.length).toBeGreaterThanOrEqual(3);
  });

  it("registers temp media route", () => {
    const routes = registerPluginAndCollectRoutes();
    expect(routes).toContain("/wecom-media");
  });

  it("uses plugin auth for all routes", () => {
    const routes: { path: string; auth: string }[] = [];
    plugin.register({
      registerChannel: () => {},
      registerTool: () => {},
      registerHttpRoute: (params: { path: string; auth: string; handler: unknown }) => {
        routes.push({ path: params.path, auth: params.auth });
      },
      on: () => {},
      config: {},
      runtime: {} as Record<string, unknown>,
      logger: { info: () => {}, debug: () => {}, error: () => {} },
    } as any);
    for (const route of routes) {
      expect(route.auth).toBe("plugin");
    }
  });
});

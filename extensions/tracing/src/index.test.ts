import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";

type Hook = (event?: Record<string, unknown>, ctx?: Record<string, unknown>) => Promise<void> | void;

function response() {
  return {
    status: 0,
    headers: {} as Record<string, string>,
    body: "",
    setHeader: vi.fn(),
    writeHead(status: number, headers: Record<string, string>) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

describe("tracing plugin", () => {
  it("ID、生命周期和认证 GET-only 路由与 OpenClaw 2026.7.1 对齐", async () => {
    const hooks = new Map<string, Hook[]>();
    const routes = new Map<string, { auth?: string; match?: string; handler: Hook }>();
    const api = {
      config: {},
      pluginConfig: { enabled: true, backend: "log", sampleRate: 1 },
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on(name: string, handler: Hook) {
        hooks.set(name, [...(hooks.get(name) ?? []), handler]);
      },
      registerHttpRoute(route: { path: string; auth?: string; match?: string; handler: Hook }) {
        routes.set(route.path, route);
      },
    };

    expect(plugin.id).toBe("tracing");
    plugin.register(api as never);
    expect(routes.size).toBe(3);
    expect([...routes.values()].every((route) => route.auth === "plugin")).toBe(true);
    expect([...routes.values()].every((route) => route.match === "exact")).toBe(true);
    expect(hooks.get("message_received")).toHaveLength(1);
    expect(hooks.get("reply_payload_sending")).toHaveLength(1);
    expect(hooks.has("agent_end")).toBe(false);

    await hooks.get("gateway_start")?.[0]?.({}, {});
    const statusResponse = response();
    await routes.get("/tracing/status")?.handler(
      { method: "GET", url: "/tracing/status", headers: {} },
      statusResponse as never,
    );
    expect(statusResponse.status).toBe(200);
    expect(JSON.parse(statusResponse.body)).toMatchObject({
      ok: true,
      data: { plugin: "tracing", status: "active", backend: "log" },
    });

    const methodResponse = response();
    await routes.get("/tracing/status")?.handler(
      { method: "POST", url: "/tracing/status", headers: {} },
      methodResponse as never,
    );
    expect(methodResponse.status).toBe(405);
    expect(methodResponse.setHeader).toHaveBeenCalledWith("Allow", "GET");

    const limitResponse = response();
    await routes.get("/tracing/traces")?.handler(
      { method: "GET", url: "/tracing/traces?limit=NaN", headers: {} },
      limitResponse as never,
    );
    expect(limitResponse.status).toBe(400);

    await hooks.get("gateway_stop")?.[0]?.({}, {});
  });
});

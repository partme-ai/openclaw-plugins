import { describe, expect, it, vi } from "vitest";
import entry from "../src/index.js";

describe("OpenClaw 2026.7.1 registration", () => {
  it("uses the standard Channel lifecycle and registers an authenticated exact status route", () => {
    const services: Array<{ start: () => Promise<void>; stop?: () => Promise<void> }> = [];
    const routes: Array<Record<string, unknown>> = [];
    const registerChannel = vi.fn();
    const api = {
      registrationMode: "full",
      config: { channels: { "wechat-ipad": {} } },
      pluginConfig: {},
      runtime: {},
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerChannel,
      registerService: (service: typeof services[number]) => services.push(service),
      registerHttpRoute: (route: Record<string, unknown>) => routes.push(route),
    };

    entry.register(api as never);
    expect(registerChannel).toHaveBeenCalledOnce();
    expect(services).toHaveLength(0);
    const registered = registerChannel.mock.calls[0]?.[0]?.plugin;
    expect(registered?.gateway?.startAccount).toBeTypeOf("function");
    expect(registered?.status?.probeAccount).toBeTypeOf("function");
    expect(routes).toEqual([
      expect.objectContaining({ path: "/wechat-ipad/status", auth: "gateway", match: "exact" }),
    ]);
    expect(routes.some((route) => route.path === "/wechat-ipad/sessions")).toBe(false);
  });
});

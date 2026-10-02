import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxies: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }>,
  starts: [] as Array<() => Promise<void>>,
}));
vi.mock("../src/config.js", () => ({ resolveMtlsConfig: () => ({ enabled: true }), validateMtlsGatewayIntegration: vi.fn() }));
vi.mock("../src/proxy-server.js", () => ({ MtlsProxyServer: class {
  start = vi.fn().mockImplementation(mocks.starts.shift() ?? (() => Promise.resolve()));
  stop = vi.fn().mockResolvedValue(undefined);
  address = vi.fn().mockReturnValue({ port: 1234 });
  constructor() { mocks.proxies.push(this); }
} }));
import plugin from "../src/index.js";

function register() {
  let service!: { start(context: unknown): Promise<void>; stop(): Promise<void> };
  let handler!: (request: unknown, response: unknown) => Promise<void>;
  plugin.register({ registrationMode: "full", pluginConfig: {}, config: {},
    registerService(value: typeof service) { service = value; },
    registerHttpRoute(value: { handler: typeof handler }) { handler = value.handler; },
  } as never);
  const context = { logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
  const status = async () => {
    const response = { end: vi.fn(), writeHead: vi.fn() };
    await handler({}, response);
    return JSON.parse(response.end.mock.calls[0][0] as string) as { running: boolean };
  };
  return { service, context, status };
}

describe("mtls registration lifecycle", () => {
  it("A.stop preserves B proxy and its status route", async () => {
    mocks.proxies.length = 0;
    const a = register(); const b = register();
    await a.service.start(a.context); await b.service.start(b.context);
    await a.service.stop(); await a.service.stop();
    expect(mocks.proxies[0].stop).toHaveBeenCalledTimes(1);
    expect(mocks.proxies[1].stop).not.toHaveBeenCalled();
    expect((await a.status()).running).toBe(false);
    expect((await b.status()).running).toBe(true);
    await b.service.stop();
  });

  it("cleans failed and cancelled starts, then restarts", async () => {
    mocks.proxies.length = 0;
    const a = register();
    mocks.starts.push(() => Promise.reject(new Error("listen failed")));
    await expect(a.service.start(a.context)).rejects.toThrow("listen failed");
    expect(mocks.proxies[0].stop).toHaveBeenCalledTimes(1);
    const gate = Promise.withResolvers<void>();
    mocks.starts.push(() => gate.promise);
    const starting = a.service.start(a.context);
    const stopping = a.service.stop();
    gate.resolve();
    await Promise.allSettled([starting, stopping]);
    expect(mocks.proxies[1].stop).toHaveBeenCalledTimes(1);
    expect((await a.status()).running).toBe(false);
    await a.service.start(a.context);
    expect((await a.status()).running).toBe(true);
    await a.service.stop();
  });
});

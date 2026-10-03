import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxies: [] as Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; address: ReturnType<typeof vi.fn> }>,
  starts: [] as Array<() => Promise<void>>,
}));
vi.mock("./config.js", () => ({ resolveOAuth2Config: () => ({ enabled: true }), validateOAuth2GatewayIntegration: vi.fn() }));
vi.mock("./proxy-server.js", () => ({ OAuth2ProxyServer: class {
  start = vi.fn().mockImplementation(mocks.starts.shift() ?? (() => Promise.resolve()));
  stop = vi.fn().mockResolvedValue(undefined);
  address = vi.fn().mockImplementation(() => ({ port: mocks.proxies.indexOf(this) + 1 }));
  constructor() { mocks.proxies.push(this); }
} }));
import plugin from "./index.js";

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
    return JSON.parse(response.end.mock.calls[0][0] as string) as { running: boolean; proxy: { port: number } | null };
  };
  return { service, context, status };
}

describe("oauth2 registration lifecycle", () => {
  it("A.stop preserves B proxy and its status route", async () => {
    mocks.proxies.length = 0;
    const a = register(); const b = register();
    await a.service.start(a.context); await b.service.start(b.context);
    const ownerA = mocks.proxies[0]; const ownerB = mocks.proxies[1];
    await a.service.stop(); await a.service.stop();
    expect(ownerA.stop).toHaveBeenCalledTimes(1);
    expect(ownerB.stop).not.toHaveBeenCalled();
    expect((await b.status()).running).toBe(true);
    expect((await a.status()).running).toBe(false);
  });

  it("releases failed and late starts, then permits restart", async () => {
    mocks.proxies.length = 0;
    const a = register();
    const failed = new Error("listen failed");
    mocks.starts.push(() => Promise.reject(failed));
    await expect(a.service.start(a.context)).rejects.toThrow("listen failed");
    expect(mocks.proxies[0].stop).toHaveBeenCalledTimes(1);
    const gate = Promise.withResolvers<void>();
    mocks.starts.push(() => gate.promise);
    const secondStart = a.service.start(a.context);
    const stopped = a.service.stop();
    gate.resolve();
    await Promise.allSettled([secondStart, stopped]);
    expect(mocks.proxies[1].stop).toHaveBeenCalledTimes(1);
    expect((await a.status()).running).toBe(false);
    await a.service.start(a.context);
    expect((await a.status()).running).toBe(true);
    await a.service.stop();
  });
});

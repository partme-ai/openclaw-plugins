import { describe, expect, test } from "vitest";

describe("prometheusPlugin register", () => {
  test("registers plugin-owned routes and exports hook/runtime metrics", async () => {
    const { default: plugin } = await import("../dist/index.js");
    const fakeApi = createFakeApi();

    let registerErr: unknown;
    try {
      plugin.register(fakeApi as unknown as Parameters<typeof plugin.register>[0]);
    } catch (err) {
      registerErr = err;
    }

    expect(registerErr).toBeUndefined();

    const routes = [...fakeApi._routes.values()];
    expect(routes).toContainEqual(expect.objectContaining({ path: "/metrics" }));
    expect(routes).toContainEqual(expect.objectContaining({ path: "/metrics/per-object" }));
    expect(routes).toContainEqual(expect.objectContaining({ path: "/metrics/detailed" }));
    expect(routes).toContainEqual(expect.objectContaining({ path: "/metrics/health" }));

    // Simulate a HTTP scrape
    const mockReq = { headers: {}, method: "GET", url: "/metrics" } as unknown as import("node:http").IncomingMessage;
    const mockRes = {} as unknown as import("node:http").ServerResponse & { statusCode: number; endedBuffer: Buffer[] };

    let handler: ((req: typeof mockReq, res: typeof mockRes) => Promise<void>) | null = null;
    fakeApi._routes.forEach((route) => {
      if (route.path === "/metrics") handler = route.handler as typeof handler;
    });
    expect(handler).not.toBeNull();

    const buffers: Buffer[] = [];
    mockRes.statusCode = 200;
    mockRes.end = ((chunk?: string | Buffer) => {
      if (chunk) {
        buffers.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      }
      return mockRes;
    }) as typeof mockRes.end;
    mockRes.writeHead = ((_status: number, _headers?: Record<string, string>) => {
      return mockRes;
    }) as typeof mockRes.writeHead;

    await handler!(mockReq, mockRes);

    const body = Buffer.concat(buffers).toString("utf-8");
    expect(body).toContain("# HELP openclaw_exporter_build_info");
    expect(body).toContain("openclaw_up");
    expect(body).toContain("openclaw_model_auth_provider_status{provider=\"openai\",status=\"ok\"} 1");
    expect(body).toContain("openclaw_sli_message_success_ratio");
    expect(body).toContain("openclaw_sli_channel_health_ratio");
  });
});

// Minimal fake API
function createFakeApi() {
  const routes = new Map<string, { path: string; handler: unknown; auth?: string }>();
  return {
    _routes: routes,
    id: "openclaw-prometheus",
    config: { gateway: { port: 18789 } },
    logger: { info() {}, warn() {}, error() {} },
    registerService() {},
    on: () => () => {},
    pluginConfig: {
      metricsPath: "/metrics",
      collectIntervalMs: 0,
      snapshotIntervalMs: 30_000,
      monitoredProviders: ["openai"],
      includeRuntime: false,
      scrapeAuthEnabled: false,
    },
    registerHttpRoute(route: { path: string; handler: unknown; auth?: string }) {
      routes.set(route.path, route);
    },
    runtime: {
      events: {
        onAgentEvent: () => () => {},
        onToolCall: () => () => {},
        onBeforeModelResolve: () => () => {},
        onModelResolve: () => () => {},
        onLlmInput: () => () => {},
        onLlmOutput: () => () => {},
        onChannelInbound: () => () => {},
        onChannelOutbound: () => () => {},
        onMessageSent: () => () => {},
        onBeforeCompaction: () => () => {},
        onSubagentStarted: () => () => {},
        onSubagentEnded: () => () => {},
        onHookInvocation: () => () => {},
      },
      sessions: {
        onRefreshSessions: () => {},
        listSessions: async () => [
          {
            id: "s1",
            accountId: "a1",
            channelId: "discord",
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
            agentId: "test",
          },
        ],
        refreshSessions: async () => {},
      },
      channels: {
        listAccounts: async () => [
          {
            channelId: "discord",
            accountId: "a1",
            linked: true,
            displayName: "Discord A",
            botUserId: "bot1",
          },
        ],
      },
      nodes: { listNodes: async () => [] },
      models: { listModels: async () => [] },
      modelAuth: {
        resolveApiKeyForProvider: async ({
          provider,
        }: {
          provider: string;
          cfg: Record<string, unknown>;
        }) => {
          if (provider === "openai") {
            return { apiKey: "sk-test", source: "env", mode: "read" };
          }
          return {};
        },
      },
      skills: { listSkills: async () => [] },
      cron: { listJobs: async () => [] },
      presence: { listOnline: async () => [] },
      usage: { queryUsage: async () => ({ inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0 }) },
      createAgentRunner: () => ({
        run: async () => ({ outcome: "success" }),
        onEvent: () => () => {},
      }),
      createToolRunner: () => ({
        run: async () => ({ ok: true }),
      }),
      getDefaultToolTimeout: () => 30_000,
      onAgentEvent: () => () => {},
    },
  };
}

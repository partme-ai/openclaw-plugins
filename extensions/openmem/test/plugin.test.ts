/**
 * openmem plugin registration, tool, and agent_end ingest tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import plugin from "../src/index.js";

function createApi(overrides: Record<string, unknown> = {}) {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    pluginConfig: {},
    logger,
    registerMemoryCapability: vi.fn(),
    registerTool: vi.fn(),
    on: vi.fn(),
    ...overrides,
  };
}

describe("openmem plugin", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exposes memory kind metadata", () => {
    expect(plugin.id).toBe("openmem");
    expect(plugin.kind).toBe("memory");
    expect(plugin.configSchema?.type).toBe("object");
  });

  it("skips registration when disabled", () => {
    const api = createApi({ pluginConfig: { enabled: false } });
    plugin.register(api as never);
    expect(api.registerMemoryCapability).not.toHaveBeenCalled();
    expect(api.registerTool).not.toHaveBeenCalled();
    expect(api.logger.info).toHaveBeenCalledWith("[openmem] Disabled");
  });

  it("registers memory capability and tool when enabled", () => {
    const api = createApi({
      pluginConfig: { baseUrl: "http://openmem.test:3317" },
    });
    plugin.register(api as never);

    expect(api.registerMemoryCapability).toHaveBeenCalledOnce();
    expect(api.registerTool).toHaveBeenCalledOnce();
    expect(api.on).toHaveBeenCalledWith("agent_end", expect.any(Function));
    expect(api.logger.info).toHaveBeenCalledWith(
      "[openmem] Memory runtime → http://openmem.test:3317",
    );
  });

  it("openmem_search tool returns formatted hits", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        chunks: [{ content: "Remember this fact", score: 0.9 }],
      }),
    } as Response);

    const api = createApi();
    plugin.register(api as never);

    const toolDef = api.registerTool.mock.calls[0][0];
    const result = await toolDef.execute("call-1", { query: "fact", limit: 5 });

    expect(result.details.count).toBe(1);
    expect(result.content[0].text).toContain("Remember this fact");
  });

  it("openmem_search tool reports empty results", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunks: [] }),
    } as Response);

    const api = createApi();
    plugin.register(api as never);

    const toolDef = api.registerTool.mock.calls[0][0];
    const result = await toolDef.execute("call-2", { query: "missing" });

    expect(result.content[0].text).toBe("No OpenMem memories found.");
    expect(result.details.count).toBe(0);
  });

  it("openmem_search clamps limit between 1 and 20", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ chunks: [] }),
    } as Response);

    const api = createApi();
    plugin.register(api as never);

    const toolDef = api.registerTool.mock.calls[0][0];
    await toolDef.execute("call-3", { query: "x", limit: 999 });

    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.limit).toBe(20);
  });

  it("agent_end skips ingest when success is false", async () => {
    const api = createApi();
    plugin.register(api as never);

    const handler = api.on.mock.calls[0][1];
    await handler({ success: false, messages: [{ role: "user", content: "hi" }] }, {
      sessionKey: "sess-1",
    });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("agent_end skips ingest when messages empty", async () => {
    const api = createApi();
    plugin.register(api as never);

    const handler = api.on.mock.calls[0][1];
    await handler({ success: true, messages: [] }, { sessionKey: "sess-1" });

    expect(fetch).not.toHaveBeenCalled();
  });

  it("agent_end posts events on successful turn", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    } as Response);

    const api = createApi({ pluginConfig: { baseUrl: "http://127.0.0.1:3317" } });
    plugin.register(api as never);

    const handler = api.on.mock.calls[0][1];
    await handler(
      {
        success: true,
        messages: [
          { role: "user", content: "hello" },
          { role: "assistant", content: "world" },
        ],
      },
      { sessionKey: "sess-abc" },
    );

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:3317/events/ingest");
    const body = JSON.parse(String(init?.body));
    expect(body.events).toHaveLength(2);
    expect(body.events[0].sessionId).toBe("sess-abc");
    expect(body.events[0].type).toBe("agent_message");
  });

  it("agent_end logs warning when ingest fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "boom",
    } as Response);

    const api = createApi();
    plugin.register(api as never);

    const handler = api.on.mock.calls[0][1];
    await handler(
      { success: true, messages: [{ role: "user", content: "x" }] },
      { sessionKey: "sess-err" },
    );

    expect(api.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[openmem] ingest failed"),
    );
  });

  it("memory runtime exposes search manager from registerMemoryCapability", async () => {
    const api = createApi();
    plugin.register(api as never);

    const runtime = api.registerMemoryCapability.mock.calls[0][0].runtime;
    const { manager } = await runtime.getMemorySearchManager();
    expect(manager.status().provider).toBe("openmem");
    expect(runtime.resolveMemoryBackendConfig()).toEqual({ backend: "builtin" });
  });
});

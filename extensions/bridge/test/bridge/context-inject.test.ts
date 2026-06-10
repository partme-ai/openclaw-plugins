import { describe, it, expect, vi } from "vitest";
import { registerContextInjection } from "../../src/bridge/context-inject.js";

function createMockApi(pluginConfig?: Record<string, unknown>) {
  const hooks: Record<string, Function[]> = {};
  return {
    pluginConfig,
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    on: vi.fn((hookName: string, handler: Function) => {
      hooks[hookName] = hooks[hookName] ?? [];
      hooks[hookName].push(handler);
    }),
    _hooks: hooks,
  } as any;
}

function invokeHook(api: ReturnType<typeof createMockApi>, hookName: string, ...args: unknown[]) {
  const handlers = api._hooks[hookName] ?? [];
  for (const handler of handlers) {
    return handler({}, ...args);
  }
  return undefined;
}

describe("registerContextInjection", () => {
  it("registers before_prompt_build hook", () => {
    const api = createMockApi();
    registerContextInjection(api);
    expect(api.on).toHaveBeenCalledWith("before_prompt_build", expect.any(Function));
  });

  it("returns appendSystemContext for known channel with default config", () => {
    const api = createMockApi({
      channels: { discord: {} },
    });
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", { channelId: "discord" });
    expect(result).toBeDefined();
    expect(result.appendSystemContext).toContain("Discord");
  });

  it("returns preset for external channel (dingtalk)", () => {
    const api = createMockApi({
      channels: { "dingtalk-connector": {} },
    });
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", { channelId: "dingtalk-connector" });
    expect(result).toBeDefined();
    expect(result.appendSystemContext).toContain("钉钉");
  });

  it("returns undefined when channelId is missing", () => {
    const api = createMockApi({
      channels: { discord: {} },
    });
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", {});
    expect(result).toBeUndefined();
  });

  it("returns undefined when channel config has enabled=false", () => {
    const api = createMockApi({
      channels: { discord: { enabled: false } },
    });
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", { channelId: "discord" });
    expect(result).toBeUndefined();
  });

  it("returns undefined when channel config has contextInjection=false", () => {
    const api = createMockApi({
      channels: { discord: { contextInjection: false } },
    });
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", { channelId: "discord" });
    expect(result).toBeUndefined();
  });

  it("returns undefined for unknown channelId", () => {
    const api = createMockApi({
      channels: { discord: {} },
    });
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", { channelId: "nonexistent" });
    expect(result).toBeUndefined();
  });

  it("returns undefined when channel is not in config", () => {
    const api = createMockApi({
      channels: { discord: {} },
    });
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", { channelId: "telegram" });
    expect(result).toBeUndefined();
  });

  it("works with multiple channels configured simultaneously", () => {
    const api = createMockApi({
      channels: {
        discord: {},
        slack: {},
        telegram: {},
      },
    });
    registerContextInjection(api);

    const discordResult = invokeHook(api, "before_prompt_build", { channelId: "discord" });
    expect(discordResult.appendSystemContext).toContain("Discord");

    const slackResult = invokeHook(api, "before_prompt_build", { channelId: "slack" });
    expect(slackResult.appendSystemContext).toContain("Slack");
  });

  it("handles empty pluginConfig gracefully", () => {
    const api = createMockApi();
    registerContextInjection(api);

    const result = invokeHook(api, "before_prompt_build", { channelId: "discord" });
    expect(result).toBeUndefined();
  });
});

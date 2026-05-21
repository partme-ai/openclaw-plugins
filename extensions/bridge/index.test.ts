import { describe, it, expect, vi } from "vitest";

const pluginModule = await import("./index.js");
const plugin = pluginModule.default;

describe("openclaw-bridge plugin", () => {
  it("exports a valid plugin definition", () => {
    expect(plugin).toBeDefined();
    expect(plugin.id).toBe("openclaw-bridge");
    expect(plugin.name).toBe("OpenClaw Bridge");
    expect(plugin.description).toContain("22");
  });

  it("has configSchema with channels property", () => {
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.configSchema.type).toBe("object");
    expect(plugin.configSchema.properties!.channels).toBeDefined();
  });

  it("register function calls api.on for hooks", () => {
    const mockOn = vi.fn();
    const mockApi = {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: mockOn,
    } as any;

    plugin.register(mockApi);

    expect(mockOn).toHaveBeenCalledWith("before_prompt_build", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("agent_end", expect.any(Function));
  });

  it("logs initialization message on register", () => {
    const mockApi = {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: vi.fn(),
    } as any;

    plugin.register(mockApi);

    expect(mockApi.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[openclaw-bridge] Initializing"),
    );
    expect(mockApi.logger.info).toHaveBeenCalledWith(
      expect.stringContaining("[openclaw-bridge] Ready"),
    );
  });
});

describe("public API exports", () => {
  it("exports channel registry symbols", () => {
    const mod = pluginModule;
    expect(mod.ALL_CHANNELS).toBeDefined();
    expect(mod.getChannelMeta).toBeDefined();
    expect(mod.ALL_CAPABILITIES).toBeDefined();
    expect(mod.getChannelCapabilities).toBeDefined();
    expect(mod.PRESETS).toBeDefined();
  });

  it("exports normalize module symbols", () => {
    const mod = pluginModule;
    expect(mod.normalizeForChannel).toBeDefined();
    expect(mod.getChannelNormalizer).toBeDefined();
    expect(mod.stripMarkdown).toBeDefined();
    expect(mod.escapeMarkdownV2).toBeDefined();
    expect(mod.convertToMrkdwn).toBeDefined();
    expect(mod.splitText).toBeDefined();
    expect(mod.stripAdvancedMarkdown).toBeDefined();
  });

  it("exports message bridge symbols", () => {
    const mod = pluginModule;
    expect(mod.deriveTraceId).toBeDefined();
    expect(mod.generateMessageId).toBeDefined();
    expect(mod.buildMessage).toBeDefined();
  });
});

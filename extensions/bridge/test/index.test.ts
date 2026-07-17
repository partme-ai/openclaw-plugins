import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

const pluginModule = await import("../src/index.js");
const plugin = pluginModule.default;

describe("openclaw-bridge plugin", () => {
  it("declares eager startup for process-wide hooks", async () => {
    const manifestPath = fileURLToPath(new URL("../openclaw.plugin.json", import.meta.url));
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
      main?: string;
      activation?: { onStartup?: boolean; onCapabilities?: string[] };
      contracts?: { hooks?: string[] };
    };

    // Bridge 不是渠道插件；若不显式要求 Gateway 启动加载，三个全局 Hook 永远不会注册。
    expect(manifest.main).toBe("dist/index.js");
    expect(manifest.activation).toEqual({ onStartup: true, onCapabilities: ["hook"] });
    expect(manifest.contracts?.hooks).toEqual([
      "before_prompt_build",
      "message_received",
      "message_sent",
    ]);
  });

  it("exports a valid plugin definition", () => {
    expect(plugin).toBeDefined();
    expect(plugin.id).toBe("bridge");
    expect(plugin.name).toBe("OpenClaw Bridge");
    expect(plugin.description).toContain("27");
  });

  it("has configSchema with channels property", () => {
    expect(plugin.configSchema).toBeDefined();
    expect(plugin.configSchema.type).toBe("object");
    expect(plugin.configSchema.properties!.channels).toBeDefined();
  });

  it("register function calls api.on for hooks", () => {
    const mockOn = vi.fn();
    const mockApi = {
      registrationMode: "full",
      pluginConfig: {},
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: mockOn,
      registerService: vi.fn(),
    } as any;

    plugin.register(mockApi);

    expect(mockOn).toHaveBeenCalledWith("before_prompt_build", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("message_received", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("message_sent", expect.any(Function));
  });

  it("logs initialization message on register", () => {
    const mockApi = {
      registrationMode: "full",
      pluginConfig: {},
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
      on: vi.fn(),
      registerService: vi.fn(),
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

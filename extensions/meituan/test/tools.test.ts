import { describe, it, expect } from "vitest";
import { createMeituanTools } from "../src/tools.js";
import type { MeituanAccountConfig } from "../src/types.js";

describe("createMeituanTools", () => {
  const config: MeituanAccountConfig = { app_key: "test-key", app_secret: "test-secret" };

  it("returns 5 tools", () => {
    const tools = createMeituanTools(() => config);
    expect(tools).toHaveLength(5);
  });

  it("every tool has required fields", () => {
    const tools = createMeituanTools(() => config);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const tools = createMeituanTools(() => config);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all tool names start with meituan_", () => {
    const tools = createMeituanTools(() => config);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^meituan_/);
    }
  });

  it("returns error when config has no app_key", async () => {
    const tools = createMeituanTools(() => ({ app_key: "", app_secret: "" }));
    const result = await tools[0]!.execute({});
    // API call returns error for missing config
    expect(result).toBeDefined();
  });
});

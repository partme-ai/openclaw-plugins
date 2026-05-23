import { describe, it, expect } from "vitest";
import { createAmapTools } from "../src/tools.js";
import type { AmapAccountConfig } from "../src/types.js";

describe("createAmapTools", () => {
  const config: AmapAccountConfig = { key: "test-amap-key" };

  it("returns 3 tools", () => {
    const tools = createAmapTools(() => config);
    expect(tools).toHaveLength(3);
  });

  it("every tool has required fields", () => {
    const tools = createAmapTools(() => config);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const tools = createAmapTools(() => config);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all tool names start with amap_", () => {
    const tools = createAmapTools(() => config);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^amap_/);
    }
  });

  it("returns error when config has no key", async () => {
    const tools = createAmapTools(() => undefined);
    const result = await tools[0]!.execute({});
    expect(result).toEqual({ error: "amap channel not configured" });
  });

  it("amap_place_detail requires id parameter", () => {
    const tools = createAmapTools(() => config);
    const detail = tools.find((t) => t.name === "amap_place_detail");
    expect(detail).toBeDefined();
    expect(detail!.parameters.properties).toHaveProperty("id");
  });

  it("amap_query_around requires location parameter", () => {
    const tools = createAmapTools(() => config);
    const around = tools.find((t) => t.name === "amap_query_around");
    expect(around).toBeDefined();
    expect(around!.parameters.properties).toHaveProperty("location");
  });
});

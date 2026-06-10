import { describe, it, expect } from "vitest";
import { createXhsTools } from "../src/tools/tools.js";
import type { XhsAccountConfig } from "../src/types.js";

describe("createXhsTools", () => {
  const config: XhsAccountConfig = { app_key: "test", app_secret: "test" };

  it("returns 6 tools", () => {
    const tools = createXhsTools(() => config);
    expect(tools).toHaveLength(6);
  });

  it("every tool has required fields", () => {
    const tools = createXhsTools(() => config);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(tool.parameters.type).toBe("object");
      expect(typeof tool.execute).toBe("function");
    }
  });

  it("tool names are unique", () => {
    const tools = createXhsTools(() => config);
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("all tool names start with xhs_", () => {
    const tools = createXhsTools(() => config);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^xhs_/);
    }
  });

  it("includes store overview aggregator", () => {
    const tools = createXhsTools(() => config);
    const overview = tools.find((t) => t.name === "xhs_fetch_store_overview");
    expect(overview).toBeDefined();
    expect(overview!.parameters.properties).toHaveProperty("date");
    expect(overview!.parameters.properties).toHaveProperty("shop_id");
  });

  it("xhs_item_on_off_shelf requires boolean on_shelf", () => {
    const tools = createXhsTools(() => config);
    const shelf = tools.find((t) => t.name === "xhs_item_on_off_shelf");
    expect(shelf).toBeDefined();
    expect(shelf!.parameters.properties).toHaveProperty("on_shelf");
  });

  it("returns error when config is undefined", async () => {
    const tools = createXhsTools(() => undefined);
    // The store overview handles missing config explicitly
    const overview = tools.find((t) => t.name === "xhs_fetch_store_overview")!;
    const result = (await overview.execute({})) as { error?: string };
    expect(result.error).toBe("xhs channel not configured");
  });
});

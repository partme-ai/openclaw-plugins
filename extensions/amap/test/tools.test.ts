import { describe, expect, it, vi } from "vitest";
import { createAmapTools } from "../src/tools/tools.js";
import type { AmapPluginConfig } from "../src/types.js";

const config: AmapPluginConfig = {
  enabled: true, key: "test", apiBaseUrl: "https://restapi.amap.com", requestTimeoutMs: 1000,
  retryAttempts: 0, maxResponseBytes: 1024, maxRequestsPerMinute: 10, ownerOnly: false,
};

describe("createAmapTools", () => {
  it("registers three unique bounded tools", () => {
    const tools = createAmapTools({ senderIsOwner: false } as never, config, { get: vi.fn() } as never);
    expect(tools.map((tool) => tool.name)).toEqual(["amap_search_places", "amap_search_nearby", "amap_place_detail"]);
    expect(tools.every((tool) => tool.parameters.additionalProperties === false)).toBe(true);
  });

  it("rejects malformed coordinates before calling AMap", async () => {
    const get = vi.fn();
    const tool = createAmapTools({ senderIsOwner: false } as never, config, { get } as never)[1]!;
    const response = await tool.execute("call", { location: "200,100" });
    expect(JSON.parse(response.content[0]!.text)).toEqual(expect.objectContaining({ success: false }));
    expect(get).not.toHaveBeenCalled();
  });

  it("enforces ownerOnly before consuming quota", async () => {
    const get = vi.fn();
    const tool = createAmapTools({ senderIsOwner: false } as never, { ...config, ownerOnly: true }, { get } as never)[2]!;
    const response = await tool.execute("call", { id: "B0TEST" });
    expect(JSON.parse(response.content[0]!.text).error).toContain("owner");
    expect(get).not.toHaveBeenCalled();
  });
});

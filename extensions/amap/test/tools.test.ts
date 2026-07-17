import { describe, expect, it, vi } from "vitest";
import { createAmapTools } from "../src/tools/tools.js";
import type { AmapPluginConfig } from "../src/types.js";

const config: AmapPluginConfig = {
  enabled: true, key: "test", apiBaseUrl: "https://restapi.amap.com", requestTimeoutMs: 1000,
  retryAttempts: 0, maxResponseBytes: 1024, maxToolResultBytes: 1024, maxRequestsPerMinute: 10,
  maxConcurrentRequests: 8, ownerOnly: false,
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

  it("enforces official POI code, ID count, and 200-record pagination boundaries", async () => {
    const get = vi.fn(async () => ({ status: "1" }));
    const tools = createAmapTools({ senderIsOwner: true } as never, config, { get } as never);

    expect(JSON.parse((await tools[0]!.execute("call", { keywords: "咖啡", types: "not-a-code" })).content[0]!.text).success).toBe(false);
    expect(JSON.parse((await tools[0]!.execute("call", { keywords: "咖啡", page_size: 25, page_num: 9 })).content[0]!.text).error).toContain("200");
    expect(JSON.parse((await tools[2]!.execute("call", { id: Array.from({ length: 11 }, (_, index) => `B${index}`).join("|") })).content[0]!.text).success).toBe(false);
    expect(get).not.toHaveBeenCalled();

    await tools[2]!.execute("call", { id: "B0TEST|B1TEST" });
    expect(get).toHaveBeenCalledWith("/v5/place/detail", { id: "B0TEST|B1TEST" });
  });

  it("prevents a large provider payload from entering the Agent context", async () => {
    const get = vi.fn(async () => ({ status: "1", pois: [{ name: "店".repeat(2_000) }] }));
    const tool = createAmapTools({ senderIsOwner: true } as never, config, { get } as never)[0]!;
    const payload = JSON.parse((await tool.execute("call", { keywords: "咖啡" })).content[0]!.text);
    expect(payload).toEqual({ success: false, error: "AMap tool result exceeded maxToolResultBytes" });
  });

  it("does not expose credentials from a client failure to the Agent", async () => {
    const get = vi.fn(async () => {
      throw new Error("failed https://alice:pass@example.test?key=test Authorization: Bearer token-1\nnext");
    });
    const tool = createAmapTools({ senderIsOwner: true } as never, config, { get } as never)[0]!;
    const payload = JSON.parse((await tool.execute("call", { keywords: "咖啡" })).content[0]!.text);
    expect(payload.error).toContain("[REDACTED]");
    expect(payload.error).not.toMatch(/alice:pass|\btest\b|token-1|\n/u);
  });
});

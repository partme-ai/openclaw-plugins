import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../src/api/openapi.js", () => ({ requestDouyinOpenApi: requestMock }));

import { createDouyinTools } from "../src/tools/tools.js";

describe("Douyin OpenAPI tools", () => {
  beforeEach(() => {
    requestMock.mockReset();
    requestMock.mockResolvedValue({ data: { error_code: 0 } });
  });

  it("maps order query arguments to the official endpoint", async () => {
    const tools = createDouyinTools(() => ({
      rootConfig: { channels: {} },
      section: { app_key: "key", app_secret: "secret", account_id: "merchant-1" },
    }));
    await tools.find((tool) => tool.name === "douyin_query_orders")!.execute({
      page_num: 2,
      page_size: 50,
      order_status: 200,
    });

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      path: "/goodlife/v1/trade/order/query/",
      method: "GET",
      retrySafe: true,
      query: expect.objectContaining({
        account_id: "merchant-1",
        page_num: 2,
        page_size: 50,
        order_status: 200,
      }),
    }));
  });

  it("maps review reply to the official endpoint and configured merchant/POI", async () => {
    const tools = createDouyinTools(() => ({
      rootConfig: { channels: {} },
      section: {
        app_key: "key",
        app_secret: "secret",
        account_id: "merchant-1",
        poi_id: "poi-1",
      },
    }));
    await tools.find((tool) => tool.name === "douyin_reply_review")!.execute({
      rate_id: "rate-1",
      text: "感谢您的评价",
    });

    expect(requestMock).toHaveBeenCalledWith(expect.objectContaining({
      path: "/goodlife/v1/akte/comment/reply/",
      method: "POST",
      body: {
        account_id: "merchant-1",
        poi_id: "poi-1",
        rate_id: "rate-1",
        text: "感谢您的评价",
      },
    }));
  });

  it("rejects pagination beyond the official 10000 row window", async () => {
    const tools = createDouyinTools(() => ({
      rootConfig: { channels: {} },
      section: { app_key: "key", app_secret: "secret", account_id: "merchant-1" },
    }));
    await expect(tools[0].execute({ page_num: 101, page_size: 100 }))
      .rejects.toThrow(/pagination limits/);
  });
});

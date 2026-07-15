import { beforeEach, describe, expect, it, vi } from "vitest";

const douyinFetchMock = vi.hoisted(() => vi.fn());
const getClientTokenMock = vi.hoisted(() => vi.fn());
const invalidateClientTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../src/shared/http.js", () => ({
  douyinFetch: douyinFetchMock,
  readResponseBodyAsBuffer: async (response: Response) => Buffer.from(await response.arrayBuffer()),
}));
vi.mock("../src/config/auth.js", () => ({
  getClientToken: getClientTokenMock,
  invalidateClientToken: invalidateClientTokenMock,
}));

import { requestDouyinOpenApi } from "../src/api/openapi.js";

describe("requestDouyinOpenApi", () => {
  beforeEach(() => {
    douyinFetchMock.mockReset();
    getClientTokenMock.mockReset().mockResolvedValue("clt-token");
    invalidateClientTokenMock.mockReset();
  });

  it("sends the access-token header and standard query parameters", async () => {
    douyinFetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { error_code: 0, orders: [] },
      extra: { error_code: 0, logid: "log-1" },
    }), { status: 200 }));

    await requestDouyinOpenApi({
      context: { account: { app_key: "key", app_secret: "secret" } },
      path: "/goodlife/v1/trade/order/query/",
      method: "GET",
      query: { account_id: "merchant-1", page_num: 1, page_size: 20 },
    });

    const [, url, init] = douyinFetchMock.mock.calls[0] as [unknown, URL, RequestInit];
    expect(url.origin).toBe("https://open.douyin.com");
    expect(url.searchParams.get("account_id")).toBe("merchant-1");
    expect(init.headers).toMatchObject({ "access-token": "clt-token" });
  });

  it("refreshes a rejected token once", async () => {
    douyinFetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { error_code: 2190008, description: "token expired" },
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { error_code: 0, orders: [] },
      }), { status: 200 }));

    await requestDouyinOpenApi({
      context: { account: { app_key: "key", app_secret: "secret" } },
      path: "/goodlife/v1/trade/order/query/",
      method: "GET",
      query: {},
    });
    expect(invalidateClientTokenMock).toHaveBeenCalledOnce();
    expect(douyinFetchMock).toHaveBeenCalledTimes(2);
  });
});

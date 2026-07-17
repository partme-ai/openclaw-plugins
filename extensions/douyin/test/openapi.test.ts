import { beforeEach, describe, expect, it, vi } from "vitest";

const douyinFetchMock = vi.hoisted(() => vi.fn());
const getClientTokenMock = vi.hoisted(() => vi.fn());
const invalidateClientTokenMock = vi.hoisted(() => vi.fn());

vi.mock("../src/shared/http.js", () => ({
  douyinFetch: douyinFetchMock,
  readResponseBodyAsBuffer: async (response: Response, maxBytes?: number) => {
    const body = Buffer.from(await response.arrayBuffer());
    if (maxBytes != null && body.length > maxBytes) throw new Error("response too large");
    return body;
  },
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

  it("forwards the life-service account header when configured", async () => {
    douyinFetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { error_code: 0, orders: [] },
    }), { status: 200 }));

    await requestDouyinOpenApi({
      context: {
        account: { app_key: "key", app_secret: "secret", account_id: "merchant-1" },
      },
      path: "/goodlife/v1/trade/order/query/",
      method: "GET",
    });

    const init = douyinFetchMock.mock.calls[0]?.[2] as RequestInit;
    expect(init.headers).toMatchObject({ "Rpc-Transit-Life-Account": "merchant-1" });
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

  it("rejects a non-object JSON response instead of reporting success", async () => {
    douyinFetchMock.mockResolvedValue(new Response("null", { status: 200 }));

    await expect(requestDouyinOpenApi({
      context: { account: { app_key: "key", app_secret: "secret" } },
      path: "/goodlife/v1/trade/order/query/",
      method: "GET",
    })).rejects.toThrow("invalid JSON");
  });

  it("treats a non-zero extra error code as failure even when data says zero", async () => {
    douyinFetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { error_code: 0 },
      extra: { error_code: 2100005, description: "bad request", logid: "log-bad" },
    }), { status: 200 }));

    await expect(requestDouyinOpenApi({
      context: { account: { app_key: "key", app_secret: "secret" } },
      path: "/goodlife/v1/trade/order/query/",
      method: "GET",
    })).rejects.toMatchObject({ code: 2100005, logId: "log-bad" });
  });
});

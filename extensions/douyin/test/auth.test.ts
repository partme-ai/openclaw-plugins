import { beforeEach, describe, expect, it, vi } from "vitest";

const douyinFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../src/shared/http.js", () => ({
  douyinFetch: douyinFetchMock,
  readResponseBodyAsBuffer: async (response: Response, maxBytes?: number) => {
    const body = Buffer.from(await response.arrayBuffer());
    if (maxBytes != null && body.length > maxBytes) throw new Error("response too large");
    return body;
  },
}));

import { clearClientTokenCache, getClientToken } from "../src/config/auth.js";

describe("getClientToken", () => {
  beforeEach(() => {
    clearClientTokenCache();
    douyinFetchMock.mockReset();
  });

  it("deduplicates concurrent token requests and caches the token", async () => {
    douyinFetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { access_token: "clt-token", expires_in: 7200, error_code: 0 },
      message: "success",
    }), { status: 200 }));
    const config = { app_key: "key", app_secret: "secret" };

    const [first, second] = await Promise.all([getClientToken(config), getClientToken(config)]);
    expect(first).toBe("clt-token");
    expect(second).toBe("clt-token");
    expect(await getClientToken(config)).toBe("clt-token");
    expect(douyinFetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces platform errors instead of returning a fake empty result", async () => {
    douyinFetchMock.mockResolvedValue(new Response(JSON.stringify({
      data: { error_code: 10013, description: "invalid client" },
      message: "error",
    }), { status: 200 }));

    await expect(getClientToken({ app_key: "bad", app_secret: "bad" }))
      .rejects.toThrow(/10013.*invalid client/);
  });

  it("rejects invalid token response JSON with a bounded error", async () => {
    douyinFetchMock.mockResolvedValue(new Response("not-json", { status: 502 }));
    await expect(getClientToken({ app_key: "key", app_secret: "secret" }))
      .rejects.toThrow(/invalid or oversized JSON.*502/);
  });
});

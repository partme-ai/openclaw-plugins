import { beforeEach, describe, expect, it, vi } from "vitest";

const undiciFetchMock = vi.hoisted(() => vi.fn());

vi.mock("../src/runtime/runtime-api.js", () => ({
  undiciFetch: undiciFetchMock,
  readResponseBodyAsBuffer: vi.fn(),
}));
vi.mock("../src/config/resolvers.js", () => ({
  resolveDouyinEgressProxyUrl: () => undefined,
}));

import { douyinFetch } from "../src/shared/http.js";

describe("douyinFetch", () => {
  beforeEach(() => {
    undiciFetchMock.mockReset().mockResolvedValue(new Response("{}"));
  });

  it("disables redirects before injecting OpenAPI credentials", async () => {
    await douyinFetch(
      undefined,
      "https://open.douyin.com/oauth/client_token/",
      {
        method: "POST",
        headers: { "access-token": "secret" },
      },
    );

    expect(undiciFetchMock).toHaveBeenCalledWith(
      "https://open.douyin.com/oauth/client_token/",
      expect.objectContaining({ method: "POST", redirect: "manual" }),
      expect.objectContaining({ userAgent: "OpenClaw/2.0 (Douyin-Channel)" }),
    );
  });
});

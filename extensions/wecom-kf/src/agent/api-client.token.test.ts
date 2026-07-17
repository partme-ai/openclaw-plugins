/** access_token 缓存隔离、共享刷新与凭据轮换测试。 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgentAccount } from "../types/index.js";

const { wecomFetchMock } = vi.hoisted(() => ({ wecomFetchMock: vi.fn() }));

vi.mock("../shared/http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/http.js")>();
  return { ...actual, wecomFetch: wecomFetchMock };
});

vi.mock("../config/index.js", () => ({
  resolveWecomEgressProxyUrlFromNetwork: vi.fn(() => undefined),
}));

import { getAccessToken } from "./api-client.js";

function createAgent(accountId: string, corpSecret: string): ResolvedAgentAccount {
  return {
    accountId,
    enabled: true,
    configured: true,
    corpId: `corp-${accountId.split("-")[0]}`,
    corpSecret,
    token: "callback-token",
    encodingAESKey: "aes",
    config: {} as ResolvedAgentAccount["config"],
  };
}

function tokenResponse(token: string): Response {
  return new Response(JSON.stringify({ access_token: token, expires_in: 7200 }), {
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  wecomFetchMock.mockReset();
});

describe("getAccessToken", () => {
  it("相同企业凭据的并发请求共享一次刷新", async () => {
    const first = createAgent("shared-a", "same-secret");
    const second = createAgent("shared-b", "same-secret");
    wecomFetchMock.mockResolvedValue(tokenResponse("shared-token"));

    expect(await Promise.all([getAccessToken(first), getAccessToken(second)])).toEqual([
      "shared-token",
      "shared-token",
    ]);
    expect(wecomFetchMock).toHaveBeenCalledTimes(1);
  });

  it("corpSecret 轮换后不复用旧 token", async () => {
    const beforeRotation = createAgent("rotation-a", "old-secret");
    const afterRotation = createAgent("rotation-a", "new-secret");
    wecomFetchMock
      .mockResolvedValueOnce(tokenResponse("old-token"))
      .mockResolvedValueOnce(tokenResponse("new-token"));

    expect(await getAccessToken(beforeRotation)).toBe("old-token");
    expect(await getAccessToken(afterRotation)).toBe("new-token");
    expect(wecomFetchMock).toHaveBeenCalledTimes(2);
  });

  it("外部 token 错误移除控制字符并限制长度", async () => {
    const agent = createAgent("sanitized-error", "error-secret");
    wecomFetchMock.mockResolvedValue(new Response(JSON.stringify({
      errcode: 40013,
      errmsg: `bad\nheader\u0000${"x".repeat(400)}`,
    })));

    const error = await getAccessToken(agent).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/^gettoken failed: 40013 bad header /);
    expect(message).not.toMatch(/[\n\u0000]/);
    expect(message.length).toBeLessThanOrEqual(256 + "gettoken failed: 40013 ".length);
  });
});

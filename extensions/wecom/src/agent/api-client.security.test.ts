import { beforeEach, describe, expect, it, vi } from "vitest";

const wecomFetch = vi.hoisted(() => vi.fn());
vi.mock("../webhook/http.js", () => ({
  wecomFetch,
  readResponseBodyAsBuffer: vi.fn(),
}));
vi.mock("./voice-transcode.js", () => ({
  needsTranscoding: vi.fn(() => false),
  transcodeBufferToAmr: vi.fn(),
}));

import { getAccessToken, sendText } from "./api-client.js";
import type { ResolvedAgentAccount } from "../types/index.js";

function agent(suffix: string, corpSecret = `secret-${suffix}`): ResolvedAgentAccount {
  return {
    accountId: `account-${suffix}`,
    enabled: true,
    configured: true,
    corpId: `corp-${suffix}`,
    corpSecret,
    agentId: 100,
    token: "callback-token",
    encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    config: {
      corpId: `corp-${suffix}`,
      corpSecret,
      agentId: 100,
      token: "callback-token",
      encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    },
  };
}

function apiResponse(value: unknown): Response {
  return { json: vi.fn().mockResolvedValue(value) } as unknown as Response;
}

beforeEach(() => wecomFetch.mockReset());

describe("Agent API 凭据缓存与错误脱敏", () => {
  it("自定义 OpenAPI 地址仅允许 HTTPS 或 loopback HTTP", async () => {
    const local = agent("local-api");
    local.config.apiBaseUrl = "http://127.0.0.1:19098";
    wecomFetch.mockResolvedValueOnce(apiResponse({ access_token: "local-token", expires_in: 7200 }));

    await expect(getAccessToken(local)).resolves.toBe("local-token");
    expect(wecomFetch.mock.calls[0]?.[0]).toBe(
      "http://127.0.0.1:19098/cgi-bin/gettoken?corpid=corp-local-api&corpsecret=secret-local-api",
    );

    const unsafe = agent("unsafe-api");
    unsafe.config.apiBaseUrl = "http://example.com";
    await expect(getAccessToken(unsafe)).rejects.toThrow("must use HTTPS");
  });

  it("同一凭据的并发刷新使用 single-flight", async () => {
    const current = agent("single-flight");
    wecomFetch.mockResolvedValue(apiResponse({ access_token: "token-1", expires_in: 7200 }));

    await expect(Promise.all([
      getAccessToken(current),
      getAccessToken(current),
      getAccessToken(current),
    ])).resolves.toEqual(["token-1", "token-1", "token-1"]);
    expect(wecomFetch).toHaveBeenCalledOnce();
  });

  it("同 corpId/agentId 轮换 Secret 后不会复用旧 token", async () => {
    const oldCredentials = agent("rotation", "old-secret");
    const newCredentials = agent("rotation", "new-secret");
    wecomFetch
      .mockResolvedValueOnce(apiResponse({ access_token: "old-token", expires_in: 7200 }))
      .mockResolvedValueOnce(apiResponse({ access_token: "new-token", expires_in: 7200 }));

    await expect(getAccessToken(oldCredentials)).resolves.toBe("old-token");
    await expect(getAccessToken(newCredentials)).resolves.toBe("new-token");
    expect(wecomFetch).toHaveBeenCalledTimes(2);
  });

  it("外部错误摘要会去除控制字符并截断", async () => {
    const current = agent("error");
    wecomFetch.mockResolvedValue(apiResponse({
      errcode: 40001,
      errmsg: `bad\nheader\r${"x".repeat(400)}`,
    }));

    const error = await getAccessToken(current).catch((caught: unknown) => caught as Error);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toMatch(/[\r\n]/);
    expect(error.message.length).toBeLessThanOrEqual(290);
  });

  it("部分失败只报告数量，不泄露用户、部门或标签 ID", async () => {
    const current = agent("partial");
    wecomFetch
      .mockResolvedValueOnce(apiResponse({ access_token: "token-partial", expires_in: 7200 }))
      .mockResolvedValueOnce(apiResponse({
        errcode: 0,
        invaliduser: "alice|bob",
        invalidparty: "secret-dept",
        invalidtag: "secret-tag",
      }));

    const error = await sendText({
      agent: current,
      toUser: "alice",
      text: "hello",
    }).catch((caught: unknown) => caught as Error);
    expect(error.message).toContain("invaliduserCount=2");
    expect(error.message).toContain("invalidpartyCount=1");
    expect(error.message).not.toContain("alice");
    expect(error.message).not.toContain("secret-dept");
    expect(error.message).not.toContain("secret-tag");
  });
});

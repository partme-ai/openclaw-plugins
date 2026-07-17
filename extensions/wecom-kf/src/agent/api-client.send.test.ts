/** KF send_msg 与并发额度预占的集成测试。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedAgentAccount } from "../types/index.js";

const { wecomFetchMock } = vi.hoisted(() => ({ wecomFetchMock: vi.fn() }));

vi.mock("../shared/http.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/http.js")>();
  return { ...actual, wecomFetch: wecomFetchMock };
});

vi.mock("../config/index.js", () => ({
  resolveWecomEgressProxyUrlFromNetwork: vi.fn(() => undefined),
}));

import { sendKfMessage } from "./api-client.js";
import {
  onKfCustomerInbound,
  peekKfSendGuardState,
  resetKfSendGuardForTests,
} from "./kf-send-guard.js";

const agent: ResolvedAgentAccount = {
  accountId: "send-test",
  enabled: true,
  configured: true,
  corpId: "corp-send-test",
  corpSecret: "secret",
  agentId: 10001,
  token: "token",
  encodingAESKey: "aes",
  config: {} as ResolvedAgentAccount["config"],
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function prepareInbound(): Promise<void> {
  await onKfCustomerInbound({ openKfId: "wk-send", externalUserId: "u-send", msgId: "msg-1" });
}

async function sendText() {
  return sendKfMessage(agent, {
    touser: "u-send",
    open_kfid: "wk-send",
    msgtype: "text",
    text: { content: "hello" },
  });
}

beforeEach(async () => {
  wecomFetchMock.mockReset();
  await prepareInbound();
});

afterEach(async () => {
  await resetKfSendGuardForTests();
});

describe("sendKfMessage 额度预占", () => {
  it("发送成功后保留预占计数", async () => {
    wecomFetchMock.mockResolvedValueOnce(jsonResponse({ access_token: "access-1", expires_in: 7200 }));
    wecomFetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: "ok", msgid: "out-1" }));

    expect(await sendText()).toMatchObject({ errcode: 0, msgid: "out-1" });
    expect((await peekKfSendGuardState("wk-send", "u-send"))?.replyCount).toBe(1);
  });

  it("企微明确返回失败时归还预占额度", async () => {
    // access token 在同一测试进程中可能命中缓存，因此以 URL 区分 token 与 send 响应。
    wecomFetchMock.mockImplementation(async (url: string) =>
      url.includes("gettoken")
        ? jsonResponse({ access_token: "access-2", expires_in: 7200 })
        : jsonResponse({ errcode: 40003, errmsg: "invalid userid" }),
    );

    expect(await sendText()).toMatchObject({ errcode: 40003 });
    expect((await peekKfSendGuardState("wk-send", "u-send"))?.replyCount).toBe(0);
  });

  it("网络异常抛出时也归还预占额度", async () => {
    wecomFetchMock.mockImplementation(async (url: string) => {
      if (url.includes("gettoken")) {
        return jsonResponse({ access_token: "access-3", expires_in: 7200 });
      }
      throw new Error("network down");
    });

    await expect(sendText()).rejects.toThrow("network down");
    expect((await peekKfSendGuardState("wk-send", "u-send"))?.replyCount).toBe(0);
  });
});

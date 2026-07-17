/**
 * Agent 已解密回调的第二道安全边界。
 *
 * `agent/webhook.ts` 负责公网请求验签与解密；本测试锁定业务处理器仍需执行的防御性约束，
 * 避免未来新增内部入口时绕过 AgentID 隔离或重复消息幂等。
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const claimInbound = vi.hoisted(() => vi.fn(async () => true));

vi.mock("../webhook/dedup.js", () => ({
  claimWecomAgentInboundMsgid: claimInbound,
}));

import { handleAgentWebhook } from "./handler.js";

type TestResponse = ServerResponse & { body: string; headers: Map<string, string> };

function response(): TestResponse {
  const headers = new Map<string, string>();
  return {
    statusCode: 200,
    body: "",
    headers,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name.toLowerCase(), String(value));
      return this;
    },
    end(value?: unknown) {
      this.body = value == null ? "" : String(value);
      return this;
    },
  } as unknown as TestResponse;
}

function request(): IncomingMessage {
  return {
    method: "POST",
    url: "/plugins/wecom/agent?msg_signature=signed",
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as IncomingMessage;
}

const agent = {
  accountId: "security-test",
  agentId: 42,
  configured: true,
  config: {},
} as never;

function verifiedPost(parsed: Record<string, unknown>) {
  return {
    timestamp: String(Math.floor(Date.now() / 1000)),
    nonce: "nonce",
    signature: "signed",
    encrypted: "ciphertext",
    decrypted: "<xml>decrypted</xml>",
    parsed,
  } as never;
}

describe("handleAgentWebhook security boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimInbound.mockResolvedValue(true);
  });

  it("rejects POST requests that bypassed the verified envelope layer", async () => {
    const res = response();
    await handleAgentWebhook({ req: request(), res, agent, config: {}, core: {} } as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("缺少上游验签结果");
    expect(claimInbound).not.toHaveBeenCalled();
  });

  it("fails closed when decrypted AgentID does not match the configured account", async () => {
    const res = response();
    await handleAgentWebhook({
      req: request(),
      res,
      agent,
      config: {},
      core: {},
      verifiedPost: verifiedPost({ AgentID: 99, MsgType: "text", FromUserName: "member-a" }),
    } as never);

    expect(res.statusCode).toBe(403);
    expect(res.body).toBe("agent_id_mismatch");
    expect(claimInbound).not.toHaveBeenCalled();
  });

  it("ACKs duplicate callbacks without logging member, chat, msgId or content", async () => {
    claimInbound.mockResolvedValue(false);
    const log = vi.fn();
    const res = response();
    await handleAgentWebhook({
      req: request(),
      res,
      agent,
      config: {},
      core: {},
      log,
      verifiedPost: verifiedPost({
        AgentID: 42,
        MsgType: "text",
        FromUserName: "member-secret",
        ChatId: "chat-secret",
        MsgId: "msg-secret",
        Content: "content-secret",
      }),
    } as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");
    expect(claimInbound).toHaveBeenCalledWith("security-test", "msg-secret");
    const logs = log.mock.calls.flat().join("\n");
    expect(logs).not.toContain("member-secret");
    expect(logs).not.toContain("chat-secret");
    expect(logs).not.toContain("msg-secret");
    expect(logs).not.toContain("content-secret");
  });
});

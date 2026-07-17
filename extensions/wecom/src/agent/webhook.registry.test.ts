import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

const handleAgentWebhook = vi.hoisted(() => vi.fn());

vi.mock("./index.js", () => ({ handleAgentWebhook }));
vi.mock("@wecom/aibot-node-sdk", () => ({
  WecomCrypto: class {
    constructor(
      private readonly token: string,
      _encodingAESKey: string,
      _corpId: string,
    ) {
      if (token === "broken") throw new Error("invalid key");
    }

    verifySignature(signature: string): boolean {
      return signature === this.token;
    }

    decrypt(value: string): string {
      if (value === "cipher") {
        return "<xml><ToUserName>corp</ToUserName><FromUserName>user</FromUserName><MsgType>text</MsgType><Content>hello</Content><AgentID>99</AgentID></xml>";
      }
      return `plain-${this.token}`;
    }
  },
}));

import {
  deregisterAgentWebhookTarget,
  handleWecomAgentWebhookRequest,
  registerAgentWebhookTarget,
  type AgentWebhookTarget,
} from "./webhook.js";

type TestResponse = ServerResponse & {
  body: string;
  headers: Map<string, string>;
};

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

function target(token: string, accountId = "same", agentId = 42): AgentWebhookTarget {
  return {
    path: "/plugins/wecom/agent",
    config: {} as AgentWebhookTarget["config"],
    runtime: { error: vi.fn(), log: vi.fn() },
    agent: {
      accountId,
      enabled: true,
      configured: true,
      corpId: "corp",
      corpSecret: "secret",
      agentId,
      token,
      encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      config: {
        corpId: "corp",
        corpSecret: "secret",
        agentId,
        token,
        encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      },
    },
  };
}

function callbackUrl(signature: string, timestamp = String(Math.floor(Date.now() / 1000))): string {
  return `/plugins/wecom/agent?msg_signature=${encodeURIComponent(signature)}&timestamp=${timestamp}&nonce=n&echostr=e`;
}

function request(method: "GET" | "POST", url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  Object.defineProperty(req, "socket", { value: { remoteAddress: "127.0.0.1" } });
  req.destroy = vi.fn();
  if (method === "POST") {
    setImmediate(() => {
      req.emit("data", Buffer.from(body ?? ""));
      req.emit("end");
    });
  }
  return req;
}

afterEach(() => {
  for (const accountId of ["same", "broken-account", "good-account", "mismatch"]) {
    deregisterAgentWebhookTarget(accountId);
  }
  handleAgentWebhook.mockReset();
});

describe("Agent Webhook 注册与失败关闭", () => {
  it("旧生命周期精确注销后不会删除热重载产生的新 target", async () => {
    const unregisterOld = registerAgentWebhookTarget(target("old"));
    const unregisterNew = registerAgentWebhookTarget(target("new"));
    unregisterOld();

    const res = response();
    await handleWecomAgentWebhookRequest(
      request("GET", callbackUrl("new")),
      res,
      {} as never,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("plain-new");
    unregisterNew();
  });

  it("拒绝超出五分钟窗口的已签名回调", async () => {
    registerAgentWebhookTarget(target("good", "good-account"));
    const stale = String(Math.floor((Date.now() - 6 * 60 * 1000) / 1000));
    const res = response();

    await handleWecomAgentWebhookRequest(
      request("GET", callbackUrl("good", stale)),
      res,
      {} as never,
    );

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ error: "stale_timestamp" });
  });

  it("单个损坏账号的密钥不会让其他账号的合法回调返回 500", async () => {
    const broken = target("broken", "broken-account");
    const good = target("good", "good-account");
    registerAgentWebhookTarget(broken);
    registerAgentWebhookTarget(good);
    const res = response();

    await handleWecomAgentWebhookRequest(
      request("GET", callbackUrl("good")),
      res,
      {} as never,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("plain-good");
    expect(broken.runtime.error).toHaveBeenCalledOnce();
  });

  it("解密后的 AgentID 不匹配时拒绝分发", async () => {
    registerAgentWebhookTarget(target("good", "mismatch", 42));
    const url = callbackUrl("good").replace("echostr=e", "");
    const res = response();

    await handleWecomAgentWebhookRequest(
      request("POST", url, "<xml><Encrypt>cipher</Encrypt></xml>"),
      res,
      {} as never,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: "agent_id_mismatch" });
    expect(handleAgentWebhook).not.toHaveBeenCalled();
  });
});

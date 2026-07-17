import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@wecom/aibot-node-sdk", () => ({
  WecomCrypto: class {
    constructor(
      private readonly token: string,
      _encodingAESKey: string,
      _receiveId: string,
    ) {
      if (token === "broken") throw new Error("bad key");
    }

    verifySignature(signature: string): boolean {
      return signature === this.token;
    }

    decrypt(value: string): string {
      if (value === "cipher") {
        return JSON.stringify({
          msgtype: "text",
          msgid: "message-1",
          aibotid: "unexpected-bot",
          chattype: "single",
          from: { userid: "user-1" },
          text: { content: "hello" },
        });
      }
      return `plain-${this.token}`;
    }
  },
}));

import { handleWecomWebhookRequest } from "./handler.js";
import { registerWecomWebhookTarget } from "./target.js";
import type { WecomWebhookTarget } from "./types.js";

type TestResponse = ServerResponse & { body: string; headers: Record<string, string> };
const unregisters: Array<() => void> = [];

function response(): TestResponse {
  return {
    statusCode: 200,
    body: "",
    headers: {},
    writeHead(statusCode: number, headers?: Record<string, string>) {
      this.statusCode = statusCode;
      this.headers = { ...this.headers, ...headers };
      return this;
    },
    end(value?: unknown) {
      this.body = value == null ? "" : String(value);
      return this;
    },
  } as unknown as TestResponse;
}

function target(token: string, accountId: string): WecomWebhookTarget {
  const botId = "expected-bot";
  return {
    path: "/plugins/wecom/bot",
    config: {} as never,
    core: {} as never,
    runtime: { log: vi.fn(), error: vi.fn() },
    account: {
      accountId,
      name: accountId,
      enabled: true,
      websocketUrl: "wss://openws.work.weixin.qq.com",
      botId,
      secret: "",
      sendThinkingMessage: true,
      connectionMode: "webhook",
      token,
      encodingAESKey: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
      receiveId: "corp",
      config: { botId },
    },
  };
}

function callbackUrl(signature: string, timestamp = String(Math.floor(Date.now() / 1000))): string {
  return `/plugins/wecom/bot?msg_signature=${encodeURIComponent(signature)}&timestamp=${timestamp}&nonce=n&echostr=e`;
}

function request(method: "GET" | "POST", url: string, body?: string): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = {};
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

function register(targetValue: WecomWebhookTarget): void {
  unregisters.push(registerWecomWebhookTarget(targetValue, [targetValue.path]));
}

afterEach(() => {
  for (const unregister of unregisters.splice(0)) unregister();
});

describe("Bot Webhook 安全边界", () => {
  it("拒绝超出五分钟窗口的签名回调", async () => {
    register(target("good", "good-account"));
    const stale = String(Math.floor((Date.now() - 6 * 60 * 1000) / 1000));
    const res = response();

    await handleWecomWebhookRequest(request("GET", callbackUrl("good", stale)), res);

    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body)).toMatchObject({ error: "stale_timestamp" });
  });

  it("损坏账号不会阻断同一路径其他账号的合法回调", async () => {
    const broken = target("broken", "broken-account");
    register(broken);
    register(target("good", "good-account"));
    const res = response();

    await handleWecomWebhookRequest(request("GET", callbackUrl("good")), res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("plain-good");
    expect(broken.runtime.error).toHaveBeenCalledOnce();
  });

  it("解密后的 aibotid 与配置不一致时拒绝进入消息管道", async () => {
    register(target("good", "good-account"));
    const url = callbackUrl("good").replace("echostr=e", "");
    const res = response();

    await handleWecomWebhookRequest(
      request("POST", url, JSON.stringify({ encrypt: "cipher" })),
      res,
    );

    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: "aibotid_mismatch" });
  });
});

/**
 * Douyin HTTP webhook handler integration tests.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";

const dispatchDouyinWebhookInboundMock = vi.hoisted(() => vi.fn());
const getDouyinRuntimeMock = vi.hoisted(() => vi.fn());

vi.mock("../src/dispatch/dispatch-inbound.js", () => ({
  dispatchDouyinWebhookInbound: dispatchDouyinWebhookInboundMock,
}));

vi.mock("../src/runtime.js", () => ({
  getDouyinRuntime: getDouyinRuntimeMock,
}));

import { createDouyinPluginHttpHandler } from "../src/inbound.js";
import type { ResolvedDouyinAccount } from "../src/types.js";

const account: ResolvedDouyinAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  app_key: "k",
  app_secret: "test-secret",
  shop_id: "shop-1",
  webhook_path: "/channels/douyin/webhook",
  config: { app_key: "k", app_secret: "test-secret" },
};

function makePostReq(body: string, headers: Record<string, string> = {}): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage & EventEmitter & { destroy?: () => void };
  req.method = "POST";
  req.headers = headers;
  req.destroy = () => req.removeAllListeners();
  setImmediate(() => {
    req.emit("data", Buffer.from(body, "utf-8"));
    req.emit("end");
  });
  return req;
}

function mockResponse(): ServerResponse & { statusCode?: number; body?: string } {
  const res = {
    statusCode: 0,
    body: "",
    writeHead(code: number, _headers?: Record<string, string>) {
      this.statusCode = code;
    },
    end(payload?: string) {
      this.body = payload ?? "";
    },
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

function signBody(secret: string, body: string): string {
  return createHash("sha1").update(secret + body, "utf8").digest("hex");
}

describe("createDouyinPluginHttpHandler", () => {
  beforeEach(() => {
    dispatchDouyinWebhookInboundMock.mockReset();
    dispatchDouyinWebhookInboundMock.mockResolvedValue("dispatched");
    getDouyinRuntimeMock.mockReturnValue({ config: { channels: {} } });
  });

  it("rejects unsupported HTTP methods with 405", async () => {
    const handler = createDouyinPluginHttpHandler({ account });
    const req = { method: "PUT", headers: {} } as IncomingMessage;
    const res = mockResponse();

    const handled = await handler(req, res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(405);
    expect(res.body).toBe("method not allowed");
  });

  it("returns challenge for verify_webhook without signature", async () => {
    const handler = createDouyinPluginHttpHandler({ account });
    const body = JSON.stringify({ event: "verify_webhook", content: { challenge: 98765 } });
    const res = mockResponse();

    await handler(makePostReq(body), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("98765");
    expect(dispatchDouyinWebhookInboundMock).not.toHaveBeenCalled();
  });

  it("returns 401 when signature invalid", async () => {
    const handler = createDouyinPluginHttpHandler({ account });
    const body = JSON.stringify({ content: { from_user_id: "u1", text: "hi" } });
    const res = mockResponse();

    await handler(
      makePostReq(body, { "x-douyin-signature": "bad-signature", "msg-id": "m1" }),
      res,
    );

    expect(res.statusCode).toBe(401);
    expect(res.body).toBe("signature mismatch");
  });

  it("dispatches signed webhook and returns success", async () => {
    const handler = createDouyinPluginHttpHandler({ account, log: { warn: vi.fn() } });
    const body = JSON.stringify({ content: { from_user_id: "user-99", text: "hello" } });
    const signature = signBody(account.app_secret, body);
    const res = mockResponse();

    await handler(
      makePostReq(body, { "x-douyin-signature": signature, "msg-id": "msg-signed-1" }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");
    expect(dispatchDouyinWebhookInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "user-99",
        messageId: "msg-signed-1",
      }),
    );
  });

  it("uses anonymous peer when sender id missing", async () => {
    const handler = createDouyinPluginHttpHandler({ account });
    const body = JSON.stringify({ content: { text: "anon" } });
    const signature = signBody(account.app_secret, body);
    const res = mockResponse();

    await handler(makePostReq(body, { "x-douyin-signature": signature }), res);

    expect(dispatchDouyinWebhookInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        peerId: "anonymous:shop-1",
      }),
    );
  });

  it("returns 413 when body exceeds limit", async () => {
    const handler = createDouyinPluginHttpHandler({ account });
    const big = "x".repeat(2 * 1024 * 1024);
    const req = new EventEmitter() as IncomingMessage & EventEmitter & { destroy?: () => void };
    req.method = "POST";
    req.headers = { "x-douyin-signature": signBody(account.app_secret, big) };
    req.destroy = () => req.removeAllListeners();
    setImmediate(() => {
      req.emit("data", Buffer.from(big, "utf-8"));
      req.emit("end");
    });
    const res = mockResponse();

    await handler(req, res);
    expect(res.statusCode).toBe(413);
    expect(res.body).toBe("payload too large");
  });
});

/**
 * Rednode webhook signature and HTTP handler tests.
 */
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const dispatchWebhookInboundMock = vi.hoisted(() => vi.fn());

vi.mock("../src/dispatch/dispatch-inbound.js", () => ({
  dispatchWebhookInbound: dispatchWebhookInboundMock,
}));

import { createXhsConfigGetter } from "../src/config.js";
import { createXhsWebhookHandler, verifyXhsWebhook } from "../src/inbound.js";
import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import type { XhsAccountConfig } from "../src/types.js";

const config: XhsAccountConfig = {
  app_key: "k",
  app_secret: "xhs-secret",
  shop_id: "shop-config",
};

function sign(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

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
    writeHead(code: number) {
      this.statusCode = code;
    },
    end(payload?: string) {
      this.body = payload ?? "";
    },
  };
  return res as ServerResponse & { statusCode?: number; body?: string };
}

describe("verifyXhsWebhook", () => {
  it("validates HMAC-SHA256 signature", () => {
    const body = '{"seller_id":"s1","text":"note"}';
    expect(verifyXhsWebhook(body, sign(body, config.app_secret!), config)).toBe(true);
  });

  it("prefers webhook_secret over app_secret", () => {
    const body = '{"event":"ping"}';
    const cfg = { ...config, webhook_secret: "wh-xhs" };
    expect(verifyXhsWebhook(body, sign(body, "wh-xhs"), cfg)).toBe(true);
  });

  it("rejects missing signature", () => {
    expect(verifyXhsWebhook("{}", undefined, config)).toBe(false);
  });

  it("rejects invalid signature", () => {
    const body = '{"a":1}';
    expect(verifyXhsWebhook(body, sign(body, "wrong"), config)).toBe(false);
  });
});

describe("createXhsWebhookHandler", () => {
  beforeEach(() => {
    dispatchWebhookInboundMock.mockReset();
    dispatchWebhookInboundMock.mockResolvedValue("dispatched");
  });

  it("returns 403 when channel not configured", async () => {
    const api = createMockPluginApi({ config: { channels: {} } });
    const handler = createXhsWebhookHandler(createXhsConfigGetter(api as never), api as never);
    const res = mockResponse();
    await handler(makePostReq("{}"), res);
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 on invalid signature", async () => {
    const api = createMockPluginApi({ config: { channels: { xhs: config } } });
    const handler = createXhsWebhookHandler(createXhsConfigGetter(api as never), api as never);
    const body = '{"shop_id":"s1"}';
    const res = mockResponse();
    await handler(makePostReq(body, { "x-xhs-signature": "00".repeat(32) }), res);
    expect(res.statusCode).toBe(403);
  });

  it("dispatches signed webhook with seller_id from body", async () => {
    const api = createMockPluginApi({ config: { channels: { xhs: config } } });
    const handler = createXhsWebhookHandler(createXhsConfigGetter(api as never), api as never);
    const body = JSON.stringify({ seller_id: "seller-9", text: "msg" });
    const signature = sign(body, config.app_secret!);
    const res = mockResponse();

    await handler(
      makePostReq(body, { "x-xhs-signature": signature, "msg-id": "xhs-1" }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(dispatchWebhookInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "xhs",
        peerId: "seller-9",
        shopId: "seller-9",
        messageId: "xhs-1",
      }),
    );
  });

  it("falls back to config shop_id for non-JSON body", async () => {
    const api = createMockPluginApi({ config: { channels: { xhs: config } } });
    const handler = createXhsWebhookHandler(createXhsConfigGetter(api as never), api as never);
    const body = "plain payload";
    const res = mockResponse();

    await handler(makePostReq(body, { "x-signature": sign(body, config.app_secret!) }), res);

    expect(dispatchWebhookInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "shop-config", shopId: "shop-config" }),
    );
  });

  it("logs timed_out dispatch but still returns 200", async () => {
    dispatchWebhookInboundMock.mockResolvedValue("timed_out");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const api = createMockPluginApi({ config: { channels: { xhs: config } } });
    const handler = createXhsWebhookHandler(createXhsConfigGetter(api as never), api as never);
    const body = JSON.stringify({ shopId: "s2" });
    const res = mockResponse();

    await handler(makePostReq(body, { "x-signature": sign(body, config.app_secret!) }), res);

    expect(res.statusCode).toBe(200);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

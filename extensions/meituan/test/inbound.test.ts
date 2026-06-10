/**
 * Meituan webhook signature and HTTP handler tests.
 */
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const dispatchWebhookInboundMock = vi.hoisted(() => vi.fn());

vi.mock("../src/dispatch/dispatch-inbound.js", () => ({
  dispatchWebhookInbound: dispatchWebhookInboundMock,
}));

import { createMeituanWebhookHandler, verifyMeituanWebhook } from "../src/inbound.js";
import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";
import { createMeituanConfigGetter } from "../src/config.js";
import type { MeituanAccountConfig } from "../src/types.js";

const config: MeituanAccountConfig = {
  app_key: "k",
  app_secret: "meituan-secret",
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

describe("verifyMeituanWebhook", () => {
  it("validates HMAC-SHA256 signature with app_secret", () => {
    const body = '{"shop_id":"s1","text":"order"}';
    const sig = sign(body, config.app_secret!);
    expect(verifyMeituanWebhook(body, sig, config)).toBe(true);
  });

  it("prefers webhook_secret over app_secret", () => {
    const body = '{"event":"ping"}';
    const cfg = { ...config, webhook_secret: "wh-only" };
    const sig = sign(body, "wh-only");
    expect(verifyMeituanWebhook(body, sig, cfg)).toBe(true);
    expect(verifyMeituanWebhook(body, sign(body, config.app_secret!), cfg)).toBe(false);
  });

  it("rejects missing signature header", () => {
    expect(verifyMeituanWebhook("{}", undefined, config)).toBe(false);
  });

  it("rejects invalid signature length", () => {
    expect(verifyMeituanWebhook("{}", "abc", config)).toBe(false);
  });

  it("rejects wrong signature", () => {
    const body = '{"a":1}';
    expect(verifyMeituanWebhook(body, sign(body, "other-secret"), config)).toBe(false);
  });
});

describe("createMeituanWebhookHandler", () => {
  beforeEach(() => {
    dispatchWebhookInboundMock.mockReset();
    dispatchWebhookInboundMock.mockResolvedValue("dispatched");
  });

  it("returns 403 when channel not configured", async () => {
    const api = createMockPluginApi({ config: { channels: {} } });
    const handler = createMeituanWebhookHandler(
      createMeituanConfigGetter(api as never),
      api as never,
    );
    const res = mockResponse();
    await handler(makePostReq("{}"), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("not configured");
  });

  it("returns 403 on invalid signature", async () => {
    const api = createMockPluginApi({ config: { channels: { meituan: config } } });
    const handler = createMeituanWebhookHandler(
      createMeituanConfigGetter(api as never),
      api as never,
    );
    const body = '{"shop_id":"s99","text":"hi"}';
    const res = mockResponse();
    await handler(makePostReq(body, { "x-meituan-signature": "deadbeef".repeat(8) }), res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("invalid signature");
  });

  it("dispatches signed webhook with shop_id from body", async () => {
    const api = createMockPluginApi({ config: { channels: { meituan: config } } });
    const handler = createMeituanWebhookHandler(
      createMeituanConfigGetter(api as never),
      api as never,
    );
    const body = JSON.stringify({ shop_id: "shop-body", text: "hello" });
    const signature = sign(body, config.app_secret!);
    const res = mockResponse();

    await handler(
      makePostReq(body, { "x-meituan-signature": signature, "msg-id": "mt-msg-1" }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");
    expect(dispatchWebhookInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "meituan",
        peerId: "shop-body",
        shopId: "shop-body",
        messageId: "mt-msg-1",
      }),
    );
  });

  it("falls back to config shop_id when body is not JSON", async () => {
    const api = createMockPluginApi({ config: { channels: { meituan: config } } });
    const handler = createMeituanWebhookHandler(
      createMeituanConfigGetter(api as never),
      api as never,
    );
    const body = "plain webhook payload";
    const signature = sign(body, config.app_secret!);
    const res = mockResponse();

    await handler(makePostReq(body, { "x-signature": signature }), res);

    expect(dispatchWebhookInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "shop-config", shopId: "shop-config" }),
    );
  });

  it("extracts message id from x-msg-id header", async () => {
    const api = createMockPluginApi({ config: { channels: { meituan: config } } });
    const handler = createMeituanWebhookHandler(
      createMeituanConfigGetter(api as never),
      api as never,
    );
    const body = JSON.stringify({ shopId: 42, event_id: "evt-ignored" });
    const signature = sign(body, config.app_secret!);
    const res = mockResponse();

    await handler(makePostReq(body, { "x-signature": signature, "x-msg-id": "hdr-id" }), res);

    expect(dispatchWebhookInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "hdr-id" }),
    );
  });
});

/**
 * Amap webhook handler and dispatch tests.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

import { createMockPluginApi } from "../../../test-utils/mock-plugin-api.js";

const dispatchChannelMessageMock = vi.hoisted(() => vi.fn(async () => undefined));
const resolveChannelDispatchIdentityMock = vi.hoisted(() =>
  vi.fn(async () => ({
    sessionKey: "agent:main:amap:direct:peer-1",
    peerId: "peer-1",
    agentId: "main",
  })),
);

vi.mock("../src/runtime/runtime-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/runtime/runtime-api.js")>();
  return {
    ...actual,
    dispatchChannelMessage: dispatchChannelMessageMock,
    resolveChannelDispatchIdentity: resolveChannelDispatchIdentityMock,
  };
});

import { createAmapConfigGetter } from "../src/config.js";
import { dispatchWebhookInbound } from "../src/dispatch/dispatch-inbound.js";
import { createAmapWebhookHandler } from "../src/inbound.js";

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

function bridgeApi() {
  const channelConfig = { key: "k", poi_id: "poi-config" };
  return createMockPluginApi({
    config: { channels: { amap: channelConfig } },
    runtime: {
      config: { channels: { amap: channelConfig } },
      channel: {
        routing: { resolveAgentRoute: vi.fn() },
        reply: { dispatchReplyFromConfig: vi.fn(async () => undefined) },
      },
    },
  }) as never;
}

describe("dispatchWebhookInbound (amap)", () => {
  beforeEach(() => {
    dispatchChannelMessageMock.mockClear();
    resolveChannelDispatchIdentityMock.mockClear();
  });

  it("returns duplicate for repeated messageId", async () => {
    const api = bridgeApi();
    const params = {
      api,
      channel: "amap",
      accountId: "default",
      peerId: "poi-1",
      shopId: "poi-1",
      rawBody: '{"text":"hello"}',
      messageId: "amap-dup-1",
    };

    expect(await dispatchWebhookInbound(params)).toBe("dispatched");
    expect(await dispatchWebhookInbound(params)).toBe("duplicate");
    expect(dispatchChannelMessageMock).toHaveBeenCalledTimes(1);
  });

  it("dispatches via bridge reply-pipeline", async () => {
    const api = bridgeApi();
    await dispatchWebhookInbound({
      api,
      channel: "amap",
      accountId: "default",
      peerId: "poi-2",
      shopId: "poi-2",
      rawBody: '{"text":"bridge"}',
      messageId: "amap-bridge-1",
    });

    expect(resolveChannelDispatchIdentityMock).toHaveBeenCalled();
    expect(dispatchChannelMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "reply-pipeline",
        channel: "amap",
        peerId: "poi-2",
        reply: expect.objectContaining({ outboundFormat: "plainText" }),
      }),
    );
  });

  it("falls back to publishInbound when bridge unavailable", async () => {
    const publishInbound = vi.fn(async () => undefined);
    const api = createMockPluginApi({
      runtime: { config: {}, channel: { publishInbound } },
    }) as never;

    const result = await dispatchWebhookInbound({
      api,
      channel: "amap",
      accountId: "default",
      peerId: "poi-3",
      shopId: "poi-3",
      rawBody: "plain",
      messageId: "amap-pub-1",
    });

    expect(result).toBe("dispatched");
    expect(publishInbound).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "amap:poi-3", content: "plain" }),
    );
  });

  it("returns skipped when no dispatch path available", async () => {
    const api = createMockPluginApi({
      runtime: { config: {}, channel: {} },
    }) as never;

    expect(
      await dispatchWebhookInbound({
        api,
        channel: "amap",
        accountId: "default",
        peerId: "poi-4",
        shopId: "poi-4",
        rawBody: "x",
        messageId: "amap-skip-1",
      }),
    ).toBe("skipped");
  });

  it("forwards unified wire metadata to bridge dispatch", async () => {
    const api = bridgeApi();
    await dispatchWebhookInbound({
      api,
      channel: "amap",
      accountId: "default",
      peerId: "poi-5",
      shopId: "poi-5",
      rawBody: JSON.stringify({ text: "structured", msg_id: "inner-1" }),
      messageId: "amap-unified-1",
    });

    expect(dispatchChannelMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "structured",
      }),
    );
  });
});

describe("createAmapWebhookHandler", () => {
  beforeEach(() => {
    dispatchChannelMessageMock.mockClear();
  });

  it("returns 200 success for valid webhook body", async () => {
    const api = bridgeApi();
    const handler = createAmapWebhookHandler(createAmapConfigGetter(api), api);
    const res = mockResponse();

    await handler(
      makePostReq(JSON.stringify({ text: "event" }), { "msg-id": "amap-h-1" }),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("success");
  });

  it("uses config poi_id when body empty", async () => {
    const api = bridgeApi();
    const handler = createAmapWebhookHandler(createAmapConfigGetter(api), api);
    const res = mockResponse();

    await handler(makePostReq("", { "msg-id": "amap-h-2" }), res);

    expect(dispatchChannelMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "poi-config" }),
    );
  });

  it("extracts message id from body event_id", async () => {
    const api = bridgeApi();
    const handler = createAmapWebhookHandler(createAmapConfigGetter(api), api);
    const res = mockResponse();

    await handler(makePostReq(JSON.stringify({ event_id: "evt-body-1", text: "x" })), res);

    expect(dispatchChannelMessageMock).toHaveBeenCalled();
  });

  it("passes parsed JSON text to bridge dispatch", async () => {
    const api = bridgeApi();
    const handler = createAmapWebhookHandler(createAmapConfigGetter(api), api);
    const res = mockResponse();

    await handler(
      makePostReq(JSON.stringify({ text: "poi event message" }), { "msg-id": "amap-text-1" }),
      res,
    );

    expect(dispatchChannelMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "poi event message" }),
    );
  });

  it("falls back to default poi when config missing", async () => {
    const api = createMockPluginApi({
      config: { channels: {} },
      runtime: {
        config: { channels: {} },
        channel: {
          routing: { resolveAgentRoute: vi.fn() },
          reply: { dispatchReplyFromConfig: vi.fn(async () => undefined) },
        },
      },
    }) as never;
    const handler = createAmapWebhookHandler(createAmapConfigGetter(api), api);
    const res = mockResponse();

    await handler(makePostReq(JSON.stringify({ text: "x" })), res);

    expect(dispatchChannelMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({ peerId: "default", extra: expect.objectContaining({ shopId: "default" }) }),
    );
  });
});

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const mediaLoader = vi.hoisted(() => vi.fn().mockResolvedValue({ buffer: Buffer.from("image"), kind: "image" }));
vi.mock("openclaw/plugin-sdk/web-media", () => ({ loadWebMediaRaw: mediaLoader }));

import plugin from "../src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function harness(options: { structured?: unknown; action?: Record<string, unknown>; adapter?: Record<string, unknown> } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "openclaw-router-plugin-"));
  directories.push(directory);
  const hooks = new Map<string, (event: unknown, ctx: unknown) => Promise<void>>();
  const routes = new Map<string, {
    auth?: string;
    match?: string;
    handler: (req: any, res: any) => Promise<void>;
  }>();
  let service: { start: () => Promise<void>; stop: () => Promise<void> } | undefined;
  const sendText = vi.fn().mockResolvedValue({ channel: "rabbitmq", messageId: "sent" });
  const api = {
    registrationMode: "full",
    session: { controls: { registerControlUiDescriptor: vi.fn() } },
    pluginConfig: {
      ...(options.structured ? { structured: options.structured } : {}),
      rules: [{
        id: "all-inbound",
        match: { channels: ["web-*"], direction: "both" },
        actions: [
          { type: "forward", target: "rabbitmq", topic: "audit/{{channel}}", ...options.action },
          { type: "reply-via", target: "wecom", to: "user-1" },
        ],
      }],
      delivery: { stateDir: directory, initialDelayMs: 10, maxDelayMs: 10, jitter: 0 },
    },
    runtime: {
      config: { current: vi.fn(() => ({})) },
      channel: { outbound: { loadAdapter: vi.fn().mockResolvedValue(options.adapter ?? { sendText }) } },
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerService(value: typeof service) { service = value; },
    on(name: string, handler: (event: unknown, ctx: unknown) => Promise<void>) { hooks.set(name, handler); },
    registerHttpRoute(route: { path: string; auth?: string; match?: string; handler: (req: any, res: any) => Promise<void> }) { routes.set(route.path, route); },
  };
  plugin.register(api as never);
  if (!service) throw new Error("service missing");
  await service.start();
  return { api, hooks, routes, sendText, service };
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timeout");
}

describe("router plugin", () => {
  it("awaits durable delivery and suppresses duplicate hook events", async () => {
    const { hooks, sendText, service } = await harness();
    const handler = hooks.get("message_received");
    await handler?.({ id: "m-1", content: "hello" }, { channelId: "web-mqtt", accountId: "a" });
    await handler?.({ id: "m-1", content: "hello" }, { channelId: "web-mqtt", accountId: "a" });
    await waitFor(() => sendText.mock.calls.length === 1);
    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({
      text: "hello", to: "openclaw-direct-topic:v1:audit%2Fweb-mqtt", deliveryQueueId: expect.any(String),
    }));
    await service.stop();
  });

  it("does not collapse unrelated events when the host provides no message identity", async () => {
    const { hooks, sendText, service } = await harness();
    const handler = hooks.get("message_received");
    await handler?.({ content: "same content" }, { channelId: "web-mqtt" });
    await handler?.({ content: "same content" }, { channelId: "web-mqtt" });
    await waitFor(() => sendText.mock.calls.length === 2);
    await service.stop();
  });

  it("stops a routed message from re-entering the same rule action", async () => {
    const { hooks, sendText, service } = await harness();
    await hooks.get("message_received")?.({ id: "m-1", content: "loop" }, { channelId: "web-mqtt" });
    await waitFor(() => sendText.mock.calls.length === 1);
    const deliveryId = sendText.mock.calls[0]?.[0]?.deliveryQueueId;
    await hooks.get("message_sent")?.({ success: true, runId: deliveryId, content: "loop" }, { channelId: "web-mqtt" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sendText).toHaveBeenCalledTimes(1);
    await service.stop();
  });

  it("recognizes Router delivery metadata even when host runId differs", async () => {
    const { hooks, sendText, service } = await harness();
    await hooks.get("message_received")?.({ id: "m-meta", content: "loop" }, { channelId: "web-mqtt" });
    await waitFor(() => sendText.mock.calls.length === 1);
    const deliveryId = sendText.mock.calls[0]?.[0]?.deliveryQueueId;

    await hooks.get("message_sent")?.({
      success: true,
      runId: "host-generated-run-id",
      content: "loop",
      metadata: { idempotencyKey: deliveryId, router: { deliveryId } },
    }, { channelId: "web-mqtt" });

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sendText).toHaveBeenCalledTimes(1);
    await service.stop();
  });

  it("delivers every reply payload in the same run, including identical chunks", async () => {
    const { hooks, sendText, service } = await harness();
    const handler = hooks.get("reply_payload_sending");
    await handler?.({ runId: "run-1", channel: "web-mqtt", kind: "block", payload: { text: "same" } }, { channelId: "web-mqtt", sessionKey: "s-1" });
    await handler?.({ runId: "run-1", channel: "web-mqtt", kind: "block", payload: { text: "same" } }, { channelId: "web-mqtt", sessionKey: "s-1" });
    await handler?.({ runId: "run-1", channel: "web-mqtt", kind: "final", payload: { text: "final" } }, { channelId: "web-mqtt", sessionKey: "s-1" });
    await waitFor(() => sendText.mock.calls.length === 3);
    expect(sendText.mock.calls.map((call) => call[0].text)).toEqual(["same", "same", "final"]);
    expect(new Set(sendText.mock.calls.map((call) => call[0].deliveryQueueId))).toHaveProperty("size", 3);
    await service.stop();
  });

  it("exposes authenticated exact status route with GET-only semantics", async () => {
    const { routes, service } = await harness();
    expect([...routes.values()]).toHaveLength(5);
    for (const registered of routes.values()) {
      expect(registered).toMatchObject({ auth: "gateway", match: "exact" });
    }
    const route = routes.get("/router/status") as any;
    const response = { status: 0, headers: {}, body: "", setHeader: vi.fn(), writeHead(status: number, headers: object) { this.status = status; this.headers = headers; }, end(body: string) { this.body = body; } };
    await route.handler({ method: "GET" }, response);
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ok: true, data: { running: true } });
    await service.stop();
  });
});


describe("structured routing", () => {
  const wire = { schemaVersion: 1, messageId: "m-structured", deliveryId: "d-structured", replyTo: "parent", threadId: "thread", parts: [
    { type: "text", text: "first" },
    { type: "media", mediaType: "image", url: "https://media.example.org/a.png" },
    { type: "text", text: "last" },
  ] };

  it("refuses undeclared media targets instead of silently sending their text", async () => {
    const h = await harness({ structured: { enabled: true } });
    try {
      await h.hooks.get("message_received")?.({ content: JSON.stringify(wire) }, { channelId: "web-mqtt" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(h.sendText).not.toHaveBeenCalled();
    } finally { await h.service.stop(); }
  });

  it("audits an explicitly configured text fallback without leaking media references", async () => {
    const h = await harness({ structured: { enabled: true }, action: { mediaFallback: "text" } });
    try {
      await h.hooks.get("message_received")?.({ content: JSON.stringify(wire) }, { channelId: "web-mqtt" });
      await waitFor(() => h.sendText.mock.calls.length === 1);
      expect(h.sendText.mock.calls[0][0].text).toBe("first\nlast");
      let response: any;
      await h.routes.get("/router/audit")?.handler({ method: "GET", url: "/router/audit" }, {
        writeHead() {}, end(value: string) { response = JSON.parse(value); },
      });
      expect(response.data).toEqual(expect.arrayContaining([expect.objectContaining({ mediaFallback: "text" })]));
    } finally { await h.service.stop(); }
  });
  it("preserves ordered media and identities across a partial failure retry", async () => {
    const sendPayload = vi.fn().mockResolvedValue({ messageId: "sent" });
    sendPayload.mockImplementationOnce(async () => ({ messageId: "first" }))
      .mockImplementationOnce(async () => { throw new Error("temporary media failure"); });
    const h = await harness({ structured: { enabled: true, allowedMediaHosts: ["media.example.org"] }, action: { payloadFormat: "structured-v1" }, adapter: { sendPayload } });
    try {
      await h.hooks.get("message_received")?.({ content: JSON.stringify(wire) }, { channelId: "web-mqtt" });
      await waitFor(() => sendPayload.mock.calls.length === 5);
      const calls = sendPayload.mock.calls.map(([call]) => call);
      expect(calls.map((call) => call.deliveryPartIndex)).toEqual([0, 1, 0, 1, 2]);
      expect(new Set(calls.map((call) => call.deliveryQueueId)).size).toBe(1);
      expect(calls[2].payload.text).toBe("first");
      expect(calls[3].payload.mediaUrl).toBe(wire.parts[1].url);
      expect(calls[4].payload.text).toBe("last");
      expect(calls.every((call) => call.replyToId === "parent" && call.threadId === "thread" && call.deliveryPartCount === 3)).toBe(true);
      expect(calls[3].payload.channelData.structuredWire).toMatchObject({ messageId: "m-structured", deliveryId: "d-structured" });
      expect(mediaLoader).toHaveBeenCalledWith(wire.parts[1].url, expect.objectContaining({ localRoots: [], maxBytes: 8388608 }));
    } finally { await h.service.stop(); }
  });

  it("rejects unknown versions before enqueue and rejects media-only unapproved hosts", async () => {
    const sendPayload = vi.fn();
    const h = await harness({ structured: { enabled: true }, action: { payloadFormat: "structured-v1" }, adapter: { sendPayload } });
    try {
      await expect(h.hooks.get("message_received")?.({ content: JSON.stringify({ ...wire, schemaVersion: 2 }) }, { channelId: "web-mqtt" })).rejects.toThrow(/Version/);
      await h.hooks.get("message_received")?.({ content: JSON.stringify({ ...wire, parts: [wire.parts[1]] }) }, { channelId: "web-mqtt" });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sendPayload).not.toHaveBeenCalled();
    } finally { await h.service.stop(); }
  });

  it("uses the real channel sendMedia contract for explicitly declared media targets", async () => {
    const order: string[] = [];
    const sendText = vi.fn(async (context) => { order.push(context.text); return { messageId: "t" }; });
    const sendMedia = vi.fn(async (context) => { order.push(context.mediaUrl); return { messageId: "m" }; });
    const h = await harness({ structured: { enabled: true, allowedMediaHosts: ["media.example.org"] }, action: { payloadFormat: "structured-v1" }, adapter: { sendText, sendMedia } });
    try {
      await h.hooks.get("message_received")?.({ content: JSON.stringify(wire) }, { channelId: "web-mqtt" });
      await waitFor(() => order.length === 3);
      expect(order).toEqual(["first", wire.parts[1].url, "last"]);
    } finally { await h.service.stop(); }
  });

});

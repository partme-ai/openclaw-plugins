import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { resolveWechatIpadConfig } from "../src/config.js";
import {
  WechatIpadBridge,
  clearActiveBridge,
  getActiveBridge,
  setActiveBridge,
} from "../src/transport/ipad-bridge.js";
import { DEFAULT_CONFIG, IpadEventType } from "../src/types.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.unstubAllGlobals();
});

describe("WechatIpadBridge integration", () => {
  it("uses authorization headers, bounded HTTP responses, and managed WS lifecycle", async () => {
    let upgradeRequest: IncomingMessage | undefined;
    let apiAuthorization: string | undefined;
    const httpServer = createServer((request, response) => {
      apiAuthorization = request.headers.authorization;
      response.setHeader("Content-Type", "application/json");
      if (request.url === "/api/status") {
        response.end(JSON.stringify({ ok: true, data: "x".repeat(2048) }));
        return;
      }
      response.end(JSON.stringify({ ok: true, data: { msgId: "local-1" } }));
    });
    const wsServer = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
      upgradeRequest = request;
      wsServer.handleUpgrade(request, socket, head, (client) => wsServer.emit("connection", client, request));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const port = (httpServer.address() as AddressInfo).port;
    cleanups.push(async () => {
      for (const client of wsServer.clients) client.terminate();
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const config = resolveWechatIpadConfig({
      enabled: true,
      acknowledgeUnofficialProtocolRisk: true,
      serviceUrl: `ws://127.0.0.1:${port}`,
      apiUrl: `http://127.0.0.1:${port}`,
      auth: { token: "top-secret" },
      message: { allowFrom: ["wxid-1"] },
      network: {
        maxResponseBytes: 1024,
        heartbeatIntervalMs: 60_000,
        pongTimeoutMs: 10_000,
      },
    });
    const bridge = new WechatIpadBridge(config, logger);
    cleanups.unshift(() => bridge.stop());

    const eventReceived = vi.fn();
    bridge.on(IpadEventType.Ready, eventReceived);
    wsServer.once("connection", (client) => {
      client.send(JSON.stringify({ type: "ready", data: { ready: true }, timestamp: Date.now() }));
    });
    await bridge.start();
    await vi.waitFor(() => expect(eventReceived).toHaveBeenCalledWith({ ready: true }));

    expect(upgradeRequest?.url).toBe("/");
    expect(upgradeRequest?.headers.authorization).toBe("Bearer top-secret");
    const sent = await bridge.sendMessage({ toWxid: "wxid-1", msgType: "text", content: "hello" });
    expect(sent).toEqual({ ok: true, data: { msgId: "local-1" } });
    expect(apiAuthorization).toBe("Bearer top-secret");
    const oversized = await bridge.getServiceStatus();
    expect(oversized).toEqual({ ok: false, error: "bridge response exceeds 1024 bytes" });
    expect(bridge.getStatusSummary()).not.toHaveProperty("serviceUrl");
  });

  it("redacts configured credentials from transport errors", async () => {
    const config = resolveWechatIpadConfig({
      enabled: true,
      acknowledgeUnofficialProtocolRisk: true,
      auth: { token: "top-secret" },
      message: { allowFrom: ["wxid-1"] },
    });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider echoed top-secret")));
    const bridge = new WechatIpadBridge(config, {
      debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    });

    await expect(bridge.sendMessage({ toWxid: "wxid-1", msgType: "text", content: "hello" }))
      .resolves.toEqual({ ok: false, error: "provider echoed [REDACTED]" });
  });

  it("rejects malformed events and only promotes a validated login status", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ noServer: true });
    httpServer.on("upgrade", (request, socket, head) => {
      wsServer.handleUpgrade(request, socket, head, (client) => wsServer.emit("connection", client, request));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const port = (httpServer.address() as AddressInfo).port;
    cleanups.push(async () => {
      for (const client of wsServer.clients) client.terminate();
      await new Promise<void>((resolve) => wsServer.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const bridge = new WechatIpadBridge(resolveWechatIpadConfig({
      enabled: true,
      acknowledgeUnofficialProtocolRisk: true,
      serviceUrl: `ws://127.0.0.1:${port}`,
      apiUrl: `http://127.0.0.1:${port}`,
      message: { allowFrom: ["wxid-1"] },
      network: { heartbeatIntervalMs: 60_000 },
    }), logger);
    cleanups.unshift(() => bridge.stop());
    wsServer.once("connection", (client) => {
      client.send("not-json");
      client.send(JSON.stringify({ type: "unknown", data: {}, timestamp: Date.now() }));
      client.send(JSON.stringify({ type: "login_status", data: { status: "forged" }, timestamp: Date.now() }));
      client.send(JSON.stringify({ type: "login_status", data: { status: "logged_in" }, timestamp: Date.now() }));
    });

    await bridge.start();
    await vi.waitFor(() => expect(bridge.getState()).toBe("logged_in"));
    expect(logger.warn).toHaveBeenCalledTimes(3);
  });

  it("fails closed for malformed HTTP envelopes and non-2xx responses", async () => {
    let requests = 0;
    const server = createServer((_, response) => {
      requests += 1;
      response.setHeader("Content-Type", "application/json");
      if (requests === 1) {
        response.end(JSON.stringify({ ok: "yes" }));
      } else if (requests === 2) {
        response.end(JSON.stringify({ ok: false, error: 42 }));
      } else {
        response.statusCode = 503;
        response.end(JSON.stringify({ ok: false, error: "unavailable" }));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
    const bridge = new WechatIpadBridge(resolveWechatIpadConfig({
      enabled: true,
      acknowledgeUnofficialProtocolRisk: true,
      serviceUrl: `ws://127.0.0.1:${port}`,
      apiUrl: `http://127.0.0.1:${port}`,
      message: { allowFrom: ["wxid-1"] },
    }), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

    await expect(bridge.getServiceStatus()).resolves.toEqual({
      ok: false,
      error: "bridge returned an invalid response envelope",
    });
    await expect(bridge.sendMessage({ toWxid: "wxid-1", msgType: "text", content: "hello" }))
      .resolves.toEqual({ ok: false, error: "bridge returned an invalid error field" });
    await expect(bridge.getServiceStatus()).resolves.toEqual({ ok: false, error: "bridge HTTP 503" });
  });

  it("surfaces initial connection failure without leaving a reconnect timer when disabled", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const bridge = new WechatIpadBridge(resolveWechatIpadConfig({
      enabled: true,
      acknowledgeUnofficialProtocolRisk: true,
      serviceUrl: `ws://127.0.0.1:${port}`,
      apiUrl: `http://127.0.0.1:${port}`,
      reconnect: { enabled: false },
      message: { allowFrom: ["wxid-1"] },
    }), { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });

    await expect(bridge.start()).rejects.toThrow("bridge connection failed");
    expect(bridge.getState()).toBe("disconnected");
    await bridge.stop();
  });

  it("does not let an old lifecycle clear a newer active bridge", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const first = new WechatIpadBridge(DEFAULT_CONFIG, logger);
    const second = new WechatIpadBridge(DEFAULT_CONFIG, logger);
    setActiveBridge(first);
    setActiveBridge(second);

    expect(clearActiveBridge(first)).toBe(false);
    expect(getActiveBridge()).toBe(second);
    expect(clearActiveBridge(second)).toBe(true);
    expect(getActiveBridge()).toBeNull();
  });
});

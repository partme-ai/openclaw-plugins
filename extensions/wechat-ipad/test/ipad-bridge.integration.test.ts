import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { resolveWechatIpadConfig } from "../src/config.js";
import { WechatIpadBridge } from "../src/transport/ipad-bridge.js";
import { IpadEventType } from "../src/types.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
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
});

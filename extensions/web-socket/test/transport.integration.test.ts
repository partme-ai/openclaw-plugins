import { createServer } from "node:net";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_WEBSOCKET_CONFIG } from "../src/config.js";
import { startWebSocketClient, stopWebSocketClient } from "../src/transport/client.js";
import { startWebSocketServer, stopWebSocketServer } from "../src/transport/server.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function config(port: number) {
  return {
    ...DEFAULT_WEBSOCKET_CONFIG,
    server: {
      ...DEFAULT_WEBSOCKET_CONFIG.server,
      wsPort: port,
      auth: { enabled: true, tokens: ["test-secret"], allowQueryToken: false },
    },
    limits: { ...DEFAULT_WEBSOCKET_CONFIG.limits, heartbeatIntervalMs: 60_000 },
  };
}

function open(url: string, options?: WebSocket.ClientOptions): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

afterEach(async () => {
  await stopWebSocketClient();
  await stopWebSocketServer();
});

describe("embedded WebSocket transport", () => {
  it("rejects unauthorized clients during HTTP upgrade", async () => {
    const port = await freePort();
    await startWebSocketServer(config(port), async () => {});
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/openclaw/ws`);
      ws.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      ws.once("error", reject);
    });
    expect(status).toBe(401);
  });

  it("does not accept query tokens unless explicitly enabled", async () => {
    const port = await freePort();
    await startWebSocketServer(config(port), async () => {});
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/openclaw/ws?token=test-secret`);
      ws.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      ws.once("error", reject);
    });
    expect(status).toBe(401);
  });

  it("rejects a browser Origin outside the configured allowlist", async () => {
    const port = await freePort();
    const cfg = config(port);
    cfg.server.allowedOrigins = ["https://app.example.com"];
    await startWebSocketServer(cfg, async () => {});
    const status = await new Promise<number>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/openclaw/ws`, {
        headers: { Authorization: "Bearer test-secret", Origin: "https://evil.example" },
      });
      ws.once("unexpected-response", (_request, response) => resolve(response.statusCode ?? 0));
      ws.once("error", reject);
    });
    expect(status).toBe(403);
  });

  it("serializes inbound work per connection and stops with an open client", async () => {
    const port = await freePort();
    const observed: string[] = [];
    await startWebSocketServer(config(port), async ({ rawPayload }) => {
      const text = JSON.parse(rawPayload).text as string;
      if (text === "first") await new Promise((resolve) => setTimeout(resolve, 25));
      observed.push(text);
    });
    const ws = await open(`ws://127.0.0.1:${port}/openclaw/ws`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    ws.send(JSON.stringify({ type: "message", text: "first" }));
    ws.send(JSON.stringify({ type: "message", text: "second" }));
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(observed).toEqual(["first", "second"]);
    const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
    await expect(stopWebSocketServer()).resolves.toBeUndefined();
    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it("client mode sends Bearer auth without copying the token into the URL", async () => {
    const port = await freePort();
    const external = new WebSocketServer({ host: "127.0.0.1", port });
    await new Promise<void>((resolve) => external.once("listening", () => resolve()));
    let requestUrl = "";
    let authorization = "";
    external.once("connection", (socket, request) => {
      requestUrl = request.url ?? "";
      authorization = String(request.headers.authorization ?? "");
      socket.send(JSON.stringify({ type: "message", text: "from-external" }));
    });
    let resolveInbound!: (value: string) => void;
    const inbound = new Promise<string>((resolve) => { resolveInbound = resolve; });
    await startWebSocketClient(
        {
          ...DEFAULT_WEBSOCKET_CONFIG,
          mode: "client",
          client: {
            ...DEFAULT_WEBSOCKET_CONFIG.client,
            url: `ws://127.0.0.1:${port}/bridge`,
            token: "client-secret",
            reconnect: { ...DEFAULT_WEBSOCKET_CONFIG.client.reconnect, enabled: false },
          },
          limits: { ...DEFAULT_WEBSOCKET_CONFIG.limits, heartbeatIntervalMs: 60_000 },
        },
      async ({ rawPayload }) => resolveInbound(JSON.parse(rawPayload).text as string),
    );
    await expect(inbound).resolves.toBe("from-external");
    expect(requestUrl).toBe("/bridge");
    expect(authorization).toBe("Bearer client-secret");
    await stopWebSocketClient();
    await new Promise<void>((resolve) => external.close(() => resolve()));
  });
});

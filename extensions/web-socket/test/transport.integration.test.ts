import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_WEBSOCKET_CONFIG } from "../src/config.js";
import { startWebSocketClient, stopWebSocketClient } from "../src/transport/client.js";
import { startWebSocketServer, stopWebSocketServer } from "../src/transport/server.js";
import { sendToConnectionConfirmed } from "../src/transport/connection-hub.js";

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
      auth: { enabled: true, tokens: ["test-secret"], allowQueryToken: false, allowProtocolToken: true },
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

  it("authenticates browser clients by subprotocol without echoing the token", async () => {
    const port = await freePort();
    await startWebSocketServer(config(port), async () => {});
    const encoded = Buffer.from("test-secret", "utf8").toString("base64url");
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const candidate = new WebSocket(`ws://127.0.0.1:${port}/openclaw/ws`, [
        "openclaw.v1",
        `openclaw.auth.${encoded}`,
      ]);
      candidate.once("open", () => resolve(candidate));
      candidate.once("error", reject);
    });
    expect(ws.protocol).toBe("openclaw.v1");
    ws.close();
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

  it("sends accepted only after the Agent handler completes", async () => {
    const port = await freePort();
    let release!: () => void;
    await startWebSocketServer(config(port), () => new Promise<void>((resolve) => { release = resolve; }));
    const ws = await open(`ws://127.0.0.1:${port}/openclaw/ws`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    const frames: Array<Record<string, unknown>> = [];
    ws.on("message", (data) => frames.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ version: "1", type: "message", text: "wait", messageId: "m-1" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(frames.some((frame) => frame.type === "accepted")).toBe(false);
    release();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(frames).toContainEqual(expect.objectContaining({ version: "1", type: "accepted", messageId: "m-1" }));
    ws.close();
  });

  it("server stop waits for an accepted Agent task to finish", async () => {
    const port = await freePort();
    let signalStarted!: () => void;
    let releaseTask!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const taskGate = new Promise<void>((resolve) => { releaseTask = resolve; });
    await startWebSocketServer(config(port), async () => {
      signalStarted();
      await taskGate;
    });
    const ws = await open(`ws://127.0.0.1:${port}/openclaw/ws`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    ws.send(JSON.stringify({ version: "1", type: "message", text: "drain-me", messageId: "drain-server-1" }));
    await started;

    let stopped = false;
    const stopping = stopWebSocketServer().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    releaseTask();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("server 停机排空期间仍向原连接投递已接纳消息的回复和 accepted", async () => {
    const port = await freePort();
    let releaseTask!: () => void;
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const taskGate = new Promise<void>((resolve) => { releaseTask = resolve; });
    const cfg = config(port);
    await startWebSocketServer(cfg, async ({ connectionId }) => {
      signalStarted();
      await taskGate;
      expect(await sendToConnectionConfirmed(
        connectionId,
        JSON.stringify({ version: "1", type: "reply", text: "reply-during-drain" }),
        cfg.limits.maxBufferedBytes,
        cfg.limits.sendTimeoutMs,
      )).toBe(true);
    });
    const ws = await open(`ws://127.0.0.1:${port}/openclaw/ws`, {
      headers: { Authorization: "Bearer test-secret" },
    });
    const received: string[] = [];
    ws.on("message", (data) => received.push(data.toString()));
    ws.send(JSON.stringify({ version: "1", type: "message", text: "drain-reply", messageId: "drain-reply-1" }));
    await started;

    const stopping = stopWebSocketServer();
    releaseTask();
    await stopping;
    expect(received.some((frame) => frame.includes("reply-during-drain"))).toBe(true);
    expect(received.some((frame) => frame.includes('"type":"accepted"'))).toBe(true);
  });

  it("accepts a real WSS connection", async () => {
    const port = await freePort();
    const certDir = mkdtempSync(join(tmpdir(), "openclaw-web-socket-"));
    const keyFile = join(certDir, "server.key");
    const certFile = join(certDir, "server.crt");
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=127.0.0.1",
      ], { stdio: "ignore" });
      const cfg = config(port);
      cfg.server.tls = { ...cfg.server.tls, enabled: true, keyFile, certFile };
      await startWebSocketServer(cfg, async () => {});
      const ws = await open(`wss://127.0.0.1:${port}/openclaw/ws`, {
        headers: { Authorization: "Bearer test-secret" },
        rejectUnauthorized: false,
      });
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    } finally {
      await stopWebSocketServer();
      rmSync(certDir, { recursive: true, force: true });
    }
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

  it("client mode sends accepted only after its Agent handler completes", async () => {
    const port = await freePort();
    const external = new WebSocketServer({ host: "127.0.0.1", port });
    await new Promise<void>((resolve) => external.once("listening", () => resolve()));
    let release!: () => void;
    const accepted = new Promise<Record<string, unknown>>((resolve) => {
      external.once("connection", (socket) => {
        socket.on("message", (data) => {
          const frame = JSON.parse(data.toString()) as Record<string, unknown>;
          if (frame.type === "accepted") resolve(frame);
        });
        socket.send(JSON.stringify({ version: "1", type: "message", text: "wait", messageId: "client-m-1" }));
      });
    });
    await startWebSocketClient({
      ...DEFAULT_WEBSOCKET_CONFIG,
      mode: "client",
      client: {
        ...DEFAULT_WEBSOCKET_CONFIG.client,
        url: `ws://127.0.0.1:${port}/bridge`,
        reconnect: { ...DEFAULT_WEBSOCKET_CONFIG.client.reconnect, enabled: false },
      },
      limits: { ...DEFAULT_WEBSOCKET_CONFIG.limits, heartbeatIntervalMs: 60_000 },
    }, () => new Promise<void>((resolve) => { release = resolve; }));
    let settled = false;
    void accepted.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    release();
    await expect(accepted).resolves.toMatchObject({ version: "1", type: "accepted", messageId: "client-m-1" });
    await stopWebSocketClient();
    await new Promise<void>((resolve) => external.close(() => resolve()));
  });

  it("client mode applies the configured inbound rate limit", async () => {
    const port = await freePort();
    const external = new WebSocketServer({ host: "127.0.0.1", port });
    await new Promise<void>((resolve) => external.once("listening", () => resolve()));
    const closed = new Promise<number>((resolve) => {
      external.once("connection", (socket) => {
        socket.once("close", (code) => resolve(code));
        socket.send(JSON.stringify({ type: "message", text: "first" }));
        socket.send(JSON.stringify({ type: "message", text: "second" }));
      });
    });
    const observed: string[] = [];
    await startWebSocketClient({
      ...DEFAULT_WEBSOCKET_CONFIG,
      mode: "client",
      client: {
        ...DEFAULT_WEBSOCKET_CONFIG.client,
        url: `ws://127.0.0.1:${port}/bridge`,
        reconnect: { ...DEFAULT_WEBSOCKET_CONFIG.client.reconnect, enabled: false },
      },
      limits: {
        ...DEFAULT_WEBSOCKET_CONFIG.limits,
        messagesPerMinute: 1,
        heartbeatIntervalMs: 60_000,
      },
    }, async ({ rawPayload }) => { observed.push(JSON.parse(rawPayload).text as string); });

    await expect(closed).resolves.toBe(1008);
    expect(observed).toEqual(["first"]);
    await stopWebSocketClient();
    await new Promise<void>((resolve) => external.close(() => resolve()));
  });

  it("client stop preserves and drains a message accepted before shutdown", async () => {
    const port = await freePort();
    const external = new WebSocketServer({ host: "127.0.0.1", port });
    await new Promise<void>((resolve) => external.once("listening", () => resolve()));
    let resolveAccepted!: (frame: Record<string, unknown>) => void;
    const accepted = new Promise<Record<string, unknown>>((resolve) => { resolveAccepted = resolve; });
    external.once("connection", (socket) => {
      socket.on("message", (data) => {
        const frame = JSON.parse(data.toString()) as Record<string, unknown>;
        if (frame.type === "accepted") resolveAccepted(frame);
      });
      socket.send(JSON.stringify({ version: "1", type: "message", text: "drain-me", messageId: "drain-client-1" }));
    });
    let signalStarted!: () => void;
    let releaseTask!: () => void;
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    const taskGate = new Promise<void>((resolve) => { releaseTask = resolve; });
    await startWebSocketClient({
      ...DEFAULT_WEBSOCKET_CONFIG,
      mode: "client",
      client: {
        ...DEFAULT_WEBSOCKET_CONFIG.client,
        url: `ws://127.0.0.1:${port}/bridge`,
        reconnect: { ...DEFAULT_WEBSOCKET_CONFIG.client.reconnect, enabled: false },
      },
      limits: { ...DEFAULT_WEBSOCKET_CONFIG.limits, heartbeatIntervalMs: 60_000 },
    }, async () => {
      signalStarted();
      await taskGate;
    });
    await started;

    let stopped = false;
    const stopping = stopWebSocketClient().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    releaseTask();
    await expect(accepted).resolves.toMatchObject({ type: "accepted", messageId: "drain-client-1" });
    await stopping;
    expect(stopped).toBe(true);
    await new Promise<void>((resolve) => external.close(() => resolve()));
  });
});

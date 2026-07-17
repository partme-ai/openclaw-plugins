import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { DEFAULT_STOMP_WS_CONFIG, validateStompWsConfig } from "../src/config.js";
import {
  getStompServerStats,
  publishToDestination,
  startStompServer,
  stopStompServer,
} from "../src/transport/server.js";
import type { StompServerConfig } from "../src/types.js";

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function frame(command: string, headers: Record<string, string> = {}, body = ""): string {
  return `${command}\n${Object.entries(headers).map(([key, value]) => `${key}:${value}\n`).join("")}\n${body}\0`;
}

function waitMessage(ws: WebSocket, token: string, timeoutMs = 2_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${token}`)); }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      const value = data.toString("utf8");
      if (value.includes(token)) { cleanup(); resolve(value); }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

function open(config: StompServerConfig, options?: WebSocket.ClientOptions): Promise<WebSocket> {
  const scheme = config.tls.enabled ? "wss" : "ws";
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${scheme}://127.0.0.1:${config.wsPort}${config.path}`, options);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let config: StompServerConfig;

beforeEach(async () => {
  config = {
    ...DEFAULT_STOMP_WS_CONFIG,
    wsPort: await freePort(),
    heartbeatIncoming: 0,
    heartbeatOutgoing: 0,
    auth: { required: true, users: [{ login: "browser", password: "secret" }] },
    tls: { ...DEFAULT_STOMP_WS_CONFIG.tls },
  };
});

afterEach(async () => {
  await stopStompServer();
});

describe("web-stomp production transport", () => {
  it("fails closed for missing users and remote plaintext", () => {
    expect(validateStompWsConfig({ ...config, auth: { required: true, users: [] } })).toContainEqual(
      expect.stringContaining("at least one"),
    );
    expect(validateStompWsConfig({ ...config, host: "0.0.0.0", auth: { required: false, users: [] } })).toEqual(
      expect.arrayContaining([expect.stringContaining("loopback"), expect.stringContaining("requires authentication")]),
    );
  });

  it("requires CONNECT and validates STOMP credentials", async () => {
    const inbound = vi.fn();
    await startStompServer(config, inbound);
    const premature = await open(config);
    const error = waitMessage(premature, "CONNECT is required");
    premature.send(frame("SEND", { destination: "/queue/agent" }, "unsafe"));
    await expect(error).resolves.toContain("ERROR");
    expect(inbound).not.toHaveBeenCalled();

    const denied = await open(config);
    const deniedError = waitMessage(denied, "Authentication failed");
    denied.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "wrong" }));
    await expect(deniedError).resolves.toContain("ERROR");
    expect(getStompServerStats().authFailures).toBe(1);

    const accepted = await open(config);
    const connected = waitMessage(accepted, "CONNECTED");
    accepted.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "secret" }));
    await expect(connected).resolves.toContain("version:1.2");
    accepted.close();
  });

  it("sends a SEND receipt only after async dispatch succeeds", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await startStompServer(config, async () => gate);
    const ws = await open(config);
    const connected = waitMessage(ws, "CONNECTED");
    ws.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "secret" }));
    await connected;
    const received: string[] = [];
    ws.on("message", (data) => received.push(data.toString("utf8")));
    ws.send(frame("SEND", { destination: "/queue/agent", receipt: "send-1" }, "hello"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(received.join("")).not.toContain("receipt-id:send-1");
    const receipt = waitMessage(ws, "receipt-id:send-1");
    release();
    await expect(receipt).resolves.toContain("RECEIPT");
    ws.close();
  });

  it("isolates session subscriptions and emits negotiated STOMP heartbeats", async () => {
    config = { ...config, heartbeatOutgoing: 20 };
    await startStompServer(config, vi.fn());
    const ws = await open(config);
    const connectedPromise = waitMessage(ws, "CONNECTED");
    ws.send(frame("CONNECT", {
      "accept-version": "1.2",
      "heart-beat": "0,10",
      login: "browser",
      passcode: "secret",
    }));
    const connected = await connectedPromise;
    const connectionId = /\nsession:([^\n]+)/.exec(connected)?.[1];
    expect(connectionId).toBeTruthy();

    const denied = waitMessage(ws, "outside this connection");
    ws.send(frame("SUBSCRIBE", { id: "foreign", destination: "/topic/session.stomp:other@main" }));
    await expect(denied).resolves.toContain("ERROR");

    const receipt = waitMessage(ws, "receipt-id:own-sub");
    ws.send(frame("SUBSCRIBE", {
      id: "own",
      destination: `/topic/session.stomp:${connectionId}@main`,
      receipt: "own-sub",
    }));
    await expect(receipt).resolves.toContain("RECEIPT");

    const heartbeat = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("missing STOMP heartbeat")), 2_000);
      ws.on("message", function onMessage(data) {
        const value = data.toString("utf8");
        if (value === "\n") {
          clearTimeout(timer);
          ws.off("message", onMessage);
          resolve(value);
        }
      });
    });
    await expect(heartbeat).resolves.toBe("\n");
    ws.close();
  });

  it("enforces browser Origin and WebSocket connection limits before upgrade", async () => {
    config = { ...config, allowedOrigins: ["https://console.example.com"], maxConnections: 1 };
    await startStompServer(config, vi.fn());
    const rejectedOrigin = new WebSocket(`ws://127.0.0.1:${config.wsPort}${config.path}`, {
      origin: "https://evil.example.com",
    });
    const originStatus = await new Promise<number>((resolve, reject) => {
      rejectedOrigin.once("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
      rejectedOrigin.once("open", () => reject(new Error("unexpected Origin acceptance")));
      rejectedOrigin.once("error", () => undefined);
    });
    expect(originStatus).toBe(403);
    expect(getStompServerStats().rejectedConnections).toBe(1);

    const allowed = await open(config, { origin: "https://console.example.com" });
    allowed.close();
    await new Promise<void>((resolve) => allowed.once("close", () => resolve()));

    const first = await open(config);
    const second = new WebSocket(`ws://127.0.0.1:${config.wsPort}${config.path}`);
    const limitStatus = await new Promise<number>((resolve, reject) => {
      second.once("unexpected-response", (_request, response) => { response.resume(); resolve(response.statusCode ?? 0); });
      second.once("open", () => reject(new Error("connection limit was not enforced")));
      second.once("error", () => undefined);
    });
    expect(limitStatus).toBe(503);
    expect(getStompServerStats().rejectedConnections).toBe(2);
    first.close();
  });

  it("closes a slow consumer before the WebSocket send buffer grows without bound", async () => {
    await startStompServer(config, vi.fn());
    const ws = await open(config);
    const connectedPromise = waitMessage(ws, "CONNECTED");
    ws.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "secret" }));
    const connected = await connectedPromise;
    const connectionId = /\nsession:([^\n]+)/.exec(connected)?.[1];
    const destination = `/topic/session.stomp:${connectionId}@main`;
    const subscribed = waitMessage(ws, "receipt-id:sub-ready");
    ws.send(frame("SUBSCRIBE", { id: "slow", destination, receipt: "sub-ready" }));
    await subscribed;

    // 握手与订阅完成后再收紧，精确验证业务 MESSAGE 的背压分支。
    config.maxBufferedBytes = 1;
    const closed = new Promise<number>((resolve) => ws.once("close", resolve));
    expect(publishToDestination(destination, "larger-than-one-byte")).toBe(0);
    await closed;
    expect(getStompServerStats().droppedOutbound).toBe(1);
  });

  it("removes stale subscriptions and accepts the same client flow after reconnect", async () => {
    await startStompServer(config, vi.fn());
    const first = await open(config);
    const firstConnectedPromise = waitMessage(first, "CONNECTED");
    first.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "secret" }));
    const firstId = /\nsession:([^\n]+)/.exec(await firstConnectedPromise)?.[1];
    const firstDestination = `/topic/session.stomp:${firstId}@main`;
    first.send(frame("SUBSCRIBE", { id: "reply", destination: firstDestination }));
    first.close();
    await new Promise<void>((resolve) => first.once("close", () => resolve()));
    // 客户端 close 事件与服务端 close 回调分属两端，等待服务端清理状态最终收敛。
    await vi.waitFor(() => expect(getStompServerStats()).toMatchObject({
      connectionCount: 0,
      subscriptionCount: 0,
    }));

    const second = await open(config);
    const secondConnectedPromise = waitMessage(second, "CONNECTED");
    second.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "secret" }));
    const secondId = /\nsession:([^\n]+)/.exec(await secondConnectedPromise)?.[1];
    expect(secondId).not.toBe(firstId);
    const secondDestination = `/topic/session.stomp:${secondId}@main`;
    const subscribed = waitMessage(second, "receipt-id:sub-ready");
    second.send(frame("SUBSCRIBE", { id: "reply", destination: secondDestination, receipt: "sub-ready" }));
    await subscribed;
    const message = waitMessage(second, "after-reconnect");
    expect(publishToDestination(secondDestination, "after-reconnect")).toBe(1);
    await expect(message).resolves.toContain("MESSAGE");
    second.close();
  });

  it("accepts a real WSS STOMP 1.2 connection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openclaw-web-stomp-"));
    const keyFile = join(directory, "server.key");
    const certFile = join(directory, "server.crt");
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=127.0.0.1",
      ], { stdio: "ignore" });
      config = { ...config, tls: { ...config.tls, enabled: true, keyFile, certFile } };
      await startStompServer(config, vi.fn());
      const ws = await open(config, { rejectUnauthorized: false });
      const connected = waitMessage(ws, "CONNECTED");
      ws.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "secret" }));
      await expect(connected).resolves.toContain("CONNECTED");
      ws.close();
    } finally {
      await stopStompServer();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back a failed listener startup and can start again", async () => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(config.wsPort, config.host, resolve));
    await expect(startStompServer(config, vi.fn())).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(getStompServerStats().running).toBe(false);
    await new Promise<void>((resolve) => occupied.close(() => resolve()));

    await startStompServer(config, vi.fn());
    expect(getStompServerStats()).toMatchObject({ running: true, connectionCount: 0 });
  });

  it("terminates active clients during gateway shutdown without hanging", async () => {
    await startStompServer(config, vi.fn());
    const ws = await open(config);
    const closed = new Promise<number>((resolve) => ws.once("close", resolve));
    const connected = waitMessage(ws, "CONNECTED");
    ws.send(frame("CONNECT", { "accept-version": "1.2", login: "browser", passcode: "secret" }));
    await connected;

    await expect(stopStompServer()).resolves.toBeUndefined();
    await expect(closed).resolves.toBeTypeOf("number");
    expect(getStompServerStats()).toMatchObject({ running: false, connectionCount: 0 });
  });
});

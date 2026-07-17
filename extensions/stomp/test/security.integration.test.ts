import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildStompTcpConfigSnapshot,
  DEFAULT_STOMP_TCP_CONFIG,
  validateStompTcpConfig,
} from "../src/config.js";
import {
  getConnectionStats,
  getStatusSnapshot,
  startStompTcpServer,
  stopStompTcpServer,
} from "../src/transport/server.js";
import type { StompTcpConfig } from "../src/types.js";

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function frame(command: string, headers: Record<string, string> = {}, body = ""): string {
  return `${command}\n${Object.entries(headers).map(([key, value]) => `${key}:${value}\n`).join("")}\n${body}\0`;
}

function waitData(socket: net.Socket, token: string, timeoutMs = 3_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => { cleanup(); reject(new Error(`timeout waiting for ${token}; got=${buffer}`)); }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes(token)) { cleanup(); resolve(buffer); }
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

function open(config: StompTcpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function authenticate(socket: net.Socket, headers: Record<string, string> = {}): Promise<string> {
  const connected = waitData(socket, "CONNECTED");
  socket.write(frame("CONNECT", {
    "accept-version": "1.2",
    "heart-beat": "0,0",
    login: "client",
    passcode: "secret",
    ...headers,
  }));
  return connected;
}

let config: StompTcpConfig;

beforeEach(async () => {
  config = {
    ...DEFAULT_STOMP_TCP_CONFIG,
    port: await freePort(),
    tlsPort: await freePort(),
    tls: { ...DEFAULT_STOMP_TCP_CONFIG.tls },
    heartbeat: { serverMs: 0, clientMs: 0 },
    auth: { required: true, users: [{ login: "client", password: "secret" }] },
  };
});

afterEach(async () => { await stopStompTcpServer(); });

describe("STOMP TCP production security", () => {
  it("fails closed for missing credentials, remote plaintext, and incomplete TLS", () => {
    expect(validateStompTcpConfig({ ...config, auth: { required: true, users: [] } })).toContainEqual(expect.stringContaining("at least one"));
    expect(validateStompTcpConfig({ ...config, host: "0.0.0.0" })).toContainEqual(expect.stringContaining("loopback"));
    expect(validateStompTcpConfig({ ...config, tls: { ...config.tls, enabled: true } })).toContainEqual(expect.stringContaining("keyFile"));
    expect(validateStompTcpConfig({
      ...config,
      auth: { required: false, users: [] },
      allowDurableSubscriptions: true,
    })).toContainEqual(expect.stringContaining("durable owners"));
    expect(validateStompTcpConfig({
      ...config,
      auth: { required: true, users: [{ login: "ambiguous", password: "one", passwordEnv: "OTHER" }] },
    })).toContainEqual(expect.stringContaining("exactly one credential"));
    expect(validateStompTcpConfig({
      ...config,
      port: 0,
      auth: { required: false, users: [] },
      tls: { ...config.tls, enabled: true, host: "0.0.0.0", keyFile: "/key", certFile: "/cert" },
    })).toContainEqual(expect.stringContaining("login authentication"));
  });

  it("redacts plaintext and hashed credentials from status snapshots", () => {
    const snapshot = buildStompTcpConfigSnapshot({
      ...config,
      tls: { ...config.tls, keyFile: "/private/stomp.key", certFile: "/private/stomp.crt" },
      auth: { required: true, users: [
        { login: "plain", password: "do-not-return" },
        { login: "hash", passwordHash: "deadbeef", hashAlgorithm: "sha512" },
      ] },
    });
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("do-not-return");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).not.toContain("/private/");
    expect(serialized).toContain("credentialConfigured");
  });

  it("requires CONNECT and verifies credentials", async () => {
    await startStompTcpServer(config, vi.fn());
    const premature = await open(config);
    const required = waitData(premature, "CONNECT is required");
    premature.write(frame("SEND", { destination: "/queue/agent" }, "unsafe"));
    await expect(required).resolves.toContain("ERROR");

    const denied = await open(config);
    const deniedError = waitData(denied, "Authentication failed");
    denied.write(frame("CONNECT", { "accept-version": "1.2", login: "client", passcode: "wrong" }));
    await expect(deniedError).resolves.toContain("ERROR");

    const accepted = await open(config);
    await expect(authenticate(accepted)).resolves.toContain("version:1.2");
    accepted.destroy();
  });

  it("returns SEND receipts only after async OpenClaw dispatch", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await startStompTcpServer(config, async () => gate);
    const socket = await open(config);
    await authenticate(socket);
    const observed: string[] = [];
    socket.on("data", (chunk) => observed.push(chunk.toString("utf8")));
    socket.write(frame("SEND", { destination: "/queue/agent", receipt: "send-1" }, "hello"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(observed.join("")).not.toContain("receipt-id:send-1");
    const receipt = waitData(socket, "receipt-id:send-1");
    release();
    await expect(receipt).resolves.toContain("RECEIPT");
    socket.destroy();
  });

  it("isolates subscriptions to the connection session", async () => {
    await startStompTcpServer(config, vi.fn());
    const socket = await open(config);
    const connected = await authenticate(socket);
    const sessionId = /\nsession:([^\n]+)/.exec(connected)?.[1];
    expect(sessionId).toBeTruthy();

    const denied = waitData(socket, "outside this connection");
    socket.write(frame("SUBSCRIBE", { id: "foreign", destination: "/topic/session.stomp-tcp:other@main" }));
    await expect(denied).resolves.toContain("ERROR");

    const receipt = waitData(socket, "receipt-id:own-ready");
    socket.write(frame("SUBSCRIBE", {
      id: "own",
      destination: `/topic/session.stomp-tcp:${sessionId}@main`,
      receipt: "own-ready",
    }));
    await expect(receipt).resolves.toContain("RECEIPT");
    socket.destroy();
  });

  it("emits negotiated STOMP heartbeat bytes", async () => {
    config = { ...config, heartbeat: { serverMs: 20, clientMs: 0 } };
    await startStompTcpServer(config, vi.fn());
    const socket = await open(config);
    await authenticate(socket, { "heart-beat": "0,10" });
    await expect(waitData(socket, "\n", 2_000)).resolves.toContain("\n");
    socket.destroy();
  });

  it("enforces maxConnections before STOMP processing", async () => {
    config = { ...config, maxConnections: 1 };
    await startStompTcpServer(config, vi.fn());
    const first = await open(config);
    const second = net.createConnection({ host: config.host, port: config.port });
    await expect(waitData(second, "connection limit exceeded")).resolves.toContain("ERROR");
    expect(getConnectionStats().total).toBe(1);
    second.destroy();
    first.destroy();
  });

  it("accepts a real TLS STOMP connection", async () => {
    const directory = mkdtempSync(join(tmpdir(), "openclaw-stomp-"));
    const keyFile = join(directory, "server.key");
    const certFile = join(directory, "server.crt");
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", keyFile, "-out", certFile, "-days", "1", "-subj", "/CN=127.0.0.1",
      ], { stdio: "ignore" });
      config = {
        ...config,
        port: 0,
        tls: { ...config.tls, enabled: true, keyFile, certFile },
      };
      await startStompTcpServer(config, vi.fn());
      const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const client = tls.connect({ host: "127.0.0.1", port: config.tlsPort, rejectUnauthorized: false }, () => resolve(client));
        client.once("error", reject);
      });
      await expect(authenticate(socket)).resolves.toContain("CONNECTED");
      expect(getConnectionStats().secure).toBe(1);
      socket.destroy();
    } finally {
      await stopStompTcpServer();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rolls back failed startup and terminates active clients on stop", async () => {
    const occupied = net.createServer();
    await new Promise<void>((resolve) => occupied.listen(config.port, config.host, resolve));
    await expect(startStompTcpServer(config, vi.fn())).rejects.toMatchObject({ code: "EADDRINUSE" });
    expect(getStatusSnapshot().running).toBe(false);
    await new Promise<void>((resolve) => occupied.close(() => resolve()));

    await startStompTcpServer(config, vi.fn());
    const socket = await open(config);
    await authenticate(socket);
    const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
    await expect(stopStompTcpServer()).resolves.toBeUndefined();
    await expect(closed).resolves.toBeUndefined();
    expect(getStatusSnapshot().running).toBe(false);
  });
});

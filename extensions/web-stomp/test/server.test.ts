/**
 * Web STOMP 服务器集成测试（WebSocket + STOMP 帧）。
 */

import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import {
  publishToDestination,
  startStompServer,
  stopStompServer,
} from "../src/transport/server.js";
import type { StompServerConfig } from "../src/types.js";
import { DEFAULT_STOMP_WS_CONFIG } from "../src/config.js";

let baseConfig: StompServerConfig;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

beforeEach(async () => {
  baseConfig = {
    ...DEFAULT_STOMP_WS_CONFIG,
    wsPort: await freePort(),
    heartbeatIncoming: 0,
    heartbeatOutgoing: 0,
    allowedAgentIds: ["demo"],
    auth: { required: false, users: [] },
    tls: { ...DEFAULT_STOMP_WS_CONFIG.tls },
  };
});

afterEach(async () => {
  await stopStompServer();
});

function frame(command: string, headers: Record<string, string> = {}, body = ""): string {
  let output = `${command}\n`;
  for (const [key, value] of Object.entries(headers)) {
    output += `${key}:${value}\n`;
  }
  output += `\n${body}\0`;
  return output;
}

async function connectWs(config = baseConfig): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${config.wsPort}${config.path}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

async function readUntil(ws: WebSocket, token: string, timeoutMs = 3000): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting for ${token}; got=${buffer}`));
    }, timeoutMs);
    const onMessage = (data: WebSocket.RawData) => {
      buffer += data.toString("utf-8");
      if (buffer.includes(token)) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off("message", onMessage);
      ws.off("error", onError);
    };
    ws.on("message", onMessage);
    ws.on("error", onError);
  });
}

describe("web-stomp server integration", () => {
  it("CONNECT + SEND should invoke inbound handler", async () => {
    const inboundSpy = vi.fn();
    await startStompServer(baseConfig, inboundSpy);

    const ws = await connectWs();
    ws.send(frame("CONNECT", { "accept-version": "1.2", host: "localhost" }));
    await readUntil(ws, "CONNECTED");

    ws.send(frame("SEND", { destination: "/queue/agent.demo" }, "hello web-stomp"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(inboundSpy).toHaveBeenCalledTimes(1);
    expect(inboundSpy.mock.calls[0][0]).toMatchObject({
      agentId: "demo",
      destination: "/queue/agent.demo",
      rawPayload: "hello web-stomp",
    });
    ws.close();
  });

  it("不会把正文相同的合法 SEND 自动判重，只透传显式 message-id", async () => {
    const inboundSpy = vi.fn();
    await startStompServer(baseConfig, inboundSpy);
    const ws = await connectWs();
    ws.send(frame("CONNECT", { "accept-version": "1.2" }));
    await readUntil(ws, "CONNECTED");

    ws.send(frame("SEND", { destination: "/queue/agent.demo" }, "same-body"));
    ws.send(frame("SEND", { destination: "/queue/agent.demo" }, "same-body"));
    ws.send(frame("SEND", { destination: "/queue/agent.demo", "message-id": "request-3" }, "same-body"));
    await vi.waitFor(() => expect(inboundSpy).toHaveBeenCalledTimes(3));

    expect(inboundSpy.mock.calls.map(([ctx]) => ctx.idempotencyKey)).toEqual([undefined, undefined, "request-3"]);
    ws.close();
  });

  it("returns a stable ERROR without exposing internal Agent failure details", async () => {
    const logger = { error: vi.fn() };
    const secret = "runtime-production-secret";
    await startStompServer(
      baseConfig,
      vi.fn().mockRejectedValue(new Error(`Agent unavailable Authorization: Bearer ${secret}`)),
      logger,
    );
    const ws = await connectWs();
    ws.send(frame("CONNECT", { "accept-version": "1.2" }));
    await readUntil(ws, "CONNECTED");

    ws.send(frame("SEND", {
      destination: "/queue/agent.demo",
      receipt: "must-not-succeed",
    }, "hello"));
    const response = await readUntil(ws, "Agent dispatch failed");
    expect(response).toContain("ERROR");
    expect(response).not.toContain("RECEIPT\nreceipt-id:must-not-succeed");
    expect(response).not.toContain(secret);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logger.error.mock.calls)).toContain("[REDACTED]");
    ws.close();
  });

  it("SUBSCRIBE + publishToDestination should deliver MESSAGE with ack header", async () => {
    await startStompServer(baseConfig, vi.fn());
    const ws = await connectWs();
    ws.send(frame("CONNECT", { "accept-version": "1.2" }));
    const connected = await readUntil(ws, "CONNECTED");

    const connectionId = /\nsession:([^\n]+)/.exec(connected)?.[1];
    expect(connectionId).toBeTruthy();
    const destination = `/topic/session.stomp:${connectionId}@demo`;
    ws.send(
      frame("SUBSCRIBE", {
        id: "sub-1",
        destination,
        ack: "client-individual",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    await publishToDestination(destination, "reply-body");
    const delivery = await readUntil(ws, "reply-body");
    expect(delivery).toContain("MESSAGE");
    expect(delivery).toMatch(/\back:/);

    ws.close();
  });

  it("停机时等待已经进入 Agent 管道的帧完成", async () => {
    let release!: () => void;
    const handler = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    baseConfig.shutdownTimeoutMs = 1_000;
    await startStompServer(baseConfig, handler);
    const ws = await connectWs();
    ws.send(frame("CONNECT", { "accept-version": "1.2" }));
    await readUntil(ws, "CONNECTED");
    ws.send(frame("SEND", { destination: "/queue/agent.demo" }, "drain-me"));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = stopStompServer().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("停机排空期间保留会话，使已接受 SEND 的 Agent 回复仍可投递", async () => {
    let release!: () => void;
    let replyDestination = "";
    const handler = vi.fn(async ({ peerId }: { peerId: string }) => {
      await new Promise<void>((resolve) => { release = resolve; });
      replyDestination = `/topic/session.${peerId}`;
      expect(await publishToDestination(replyDestination, "reply-before-stop")).toBe(1);
    });
    await startStompServer(baseConfig, handler);
    const ws = await connectWs();
    ws.send(frame("CONNECT", { "accept-version": "1.2" }));
    const connected = await readUntil(ws, "CONNECTED");
    const connectionId = /\nsession:([^\n]+)/.exec(connected)?.[1];
    expect(connectionId).toBeTruthy();
    replyDestination = `/topic/session.stomp:${connectionId}@demo`;
    ws.send(frame("SUBSCRIBE", { id: "reply", destination: replyDestination, receipt: "sub-ready" }));
    await readUntil(ws, "receipt-id:sub-ready");
    const reply = readUntil(ws, "reply-before-stop");
    ws.send(frame("SEND", { destination: "/queue/agent.demo" }, "drain-and-reply"));
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));

    const stopping = stopStompServer();
    release();
    await expect(reply).resolves.toContain("MESSAGE");
    await stopping;
  });

  it("重复启动时显式失败，避免调用方误以为新配置已生效", async () => {
    await startStompServer(baseConfig, vi.fn());
    await expect(startStompServer(baseConfig, vi.fn())).rejects.toThrow("already running");
  });

  it("should parse multiple STOMP frames in one WebSocket message", async () => {
    const inboundSpy = vi.fn();
    await startStompServer(baseConfig, inboundSpy);
    const ws = await connectWs();

    const combined =
      frame("CONNECT", { "accept-version": "1.2" }) +
      frame("SEND", { destination: "/queue/agent" }, "batch-1");
    ws.send(combined);
    await readUntil(ws, "CONNECTED");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(inboundSpy).toHaveBeenCalledTimes(1);
    expect(inboundSpy.mock.calls[0][0].rawPayload).toBe("batch-1");
    ws.close();
  });
});

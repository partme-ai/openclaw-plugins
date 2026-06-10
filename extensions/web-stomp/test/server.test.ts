/**
 * Web STOMP 服务器集成测试（WebSocket + STOMP 帧）。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import {
  publishToDestination,
  startStompServer,
  stopStompServer,
} from "../src/transport/server.js";
import type { StompServerConfig } from "../src/types.js";

const baseConfig: StompServerConfig = {
  wsPort: 35674,
  path: "/ws",
  heartbeatIncoming: 10_000,
  heartbeatOutgoing: 10_000,
  maxConnections: 50,
};

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

async function connectWs(): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${baseConfig.wsPort}${baseConfig.path}`);
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

  it("SUBSCRIBE + publishToDestination should deliver MESSAGE with ack header", async () => {
    await startStompServer(baseConfig, vi.fn());
    const ws = await connectWs();
    ws.send(frame("CONNECT", { "accept-version": "1.2" }));
    await readUntil(ws, "CONNECTED");

    ws.send(
      frame("SUBSCRIBE", {
        id: "sub-1",
        destination: "/topic/session.demo",
        ack: "client-individual",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    publishToDestination("/topic/session.demo", "reply-body");
    const delivery = await readUntil(ws, "reply-body");
    expect(delivery).toContain("MESSAGE");
    expect(delivery).toMatch(/\back:/);

    ws.close();
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

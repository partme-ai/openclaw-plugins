/**
 * STOMP TCP 服务器集成测试（真实 net socket）。
 */

import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishToDestination, startStompTcpServer, stopStompTcpServer } from "../src/transport/server.js";
import type { InboundMessage, StompTcpConfig } from "../src/types.js";

const baseConfig: StompTcpConfig = {
  port: 61673,
  tlsPort: 0,
  tls: { enabled: false },
  heartbeat: { serverMs: 5000, clientMs: 5000 },
  maxConnections: 20,
  maxFrameSize: 1024 * 1024,
  auth: { required: false },
  subscribeTopics: [],
  topicBindings: [],
  defaultAckMode: "auto",
  prefetchCount: 1,
};

afterEach(async () => {
  await stopStompTcpServer();
});

function frame(command: string, headers: Record<string, string> = {}, body = ""): string {
  let output = `${command}\n`;
  for (const [key, value] of Object.entries(headers)) {
    output += `${key}:${value}\n`;
  }
  output += `\n${body}\0`;
  return output;
}

async function connectClient(): Promise<net.Socket> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: baseConfig.port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function readUntil(socket: net.Socket, token: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`timeout waiting token=${token}; got=${buffer}`));
    }, 3000);
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
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
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

describe("stomp-server integration", () => {
  it("CONNECT + SEND should route by topic binding", async () => {
    const inboundSpy = vi.fn<(m: InboundMessage) => void>();
    await startStompTcpServer(
      {
        ...baseConfig,
        topicBindings: [
          {
            topicPattern: "devices/*/in",
            agentId: "iot-agent",
            accountId: "default",
            replyTopic: "/topic/devices/reply",
          },
        ],
      },
      inboundSpy,
    );

    const client = await connectClient();
    client.write(frame("CONNECT", { "accept-version": "1.2" }));
    await readUntil(client, "CONNECTED");

    client.write(frame("SEND", { destination: "/topic/devices/alpha/in" }, "hello"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(inboundSpy).toHaveBeenCalledTimes(1);
    expect(inboundSpy.mock.calls[0][0]).toMatchObject({
      agentId: "iot-agent",
      destination: "/topic/devices/alpha/in",
      replyDestination: "/topic/devices/reply",
      rawPayload: "hello",
    });
    client.destroy();
  });

  it("SUBSCRIBE with client ack + prefetch should require ACK", async () => {
    await startStompTcpServer(baseConfig, vi.fn());
    const client = await connectClient();
    client.write(frame("CONNECT", { "accept-version": "1.2" }));
    await readUntil(client, "CONNECTED");

    client.write(
      frame("SUBSCRIBE", {
        id: "sub-1",
        destination: "/topic/session.demo",
        ack: "client-individual",
        "prefetch-count": "1",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    publishToDestination("/topic/session.demo", "m1");
    publishToDestination("/topic/session.demo", "m2");
    const firstDelivery = await readUntil(client, "m1");
    expect(firstDelivery).toContain("MESSAGE");
    expect(firstDelivery).toContain("ack:");

    client.write(frame("ACK", { id: firstDelivery.match(/ack:([^\n]+)/)?.[1] ?? "" }));
    const secondDelivery = await readUntil(client, "m2");
    expect(secondDelivery).toContain("MESSAGE");
    client.destroy();
  });

  it("NACK with requeue=true should redeliver same message", async () => {
    await startStompTcpServer(baseConfig, vi.fn());
    const client = await connectClient();
    client.write(frame("CONNECT", { "accept-version": "1.2" }));
    await readUntil(client, "CONNECTED");

    client.write(
      frame("SUBSCRIBE", {
        id: "sub-2",
        destination: "/topic/session.nack",
        ack: "client-individual",
        "prefetch-count": "1",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));

    publishToDestination("/topic/session.nack", "redeliver-me");
    const first = await readUntil(client, "redeliver-me");
    const ackId = first.match(/ack:([^\n]+)/)?.[1];
    expect(ackId).toBeTruthy();
    client.write(frame("NACK", { id: ackId ?? "", requeue: "true" }));
    const second = await readUntil(client, "redeliver-me");
    expect(second).toContain("MESSAGE");
    client.destroy();
  });
});

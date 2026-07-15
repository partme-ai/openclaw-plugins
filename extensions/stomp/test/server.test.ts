import net from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_STOMP_TCP_CONFIG } from "../src/config.js";
import { publishToDestination, startStompTcpServer, stopStompTcpServer } from "../src/transport/server.js";
import type { InboundMessage, StompTcpConfig } from "../src/types.js";

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

function readUntil(socket: net.Socket, token: string, timeoutMs = 3_000): Promise<string> {
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

function connectClient(config: StompTcpConfig): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port }, () => resolve(socket));
    socket.once("error", reject);
  });
}

async function stompConnect(socket: net.Socket): Promise<string> {
  const connected = readUntil(socket, "CONNECTED");
  socket.write(frame("CONNECT", { "accept-version": "1.2", "heart-beat": "0,0" }));
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
    auth: { required: false, users: [] },
    allowSharedTopics: true,
  };
});

afterEach(async () => { await stopStompTcpServer(); });

describe("stomp TCP server", () => {
  it("routes SEND through an explicit topic binding", async () => {
    const inbound = vi.fn<(message: InboundMessage) => Promise<void>>().mockResolvedValue(undefined);
    config = {
      ...config,
      topicBindings: [{ topicPattern: "devices/*/in", agentId: "iot-agent", replyTopic: "/topic/devices/reply" }],
    };
    await startStompTcpServer(config, inbound);
    const client = await connectClient(config);
    await stompConnect(client);

    const receipt = readUntil(client, "receipt-id:send-1");
    client.write(frame("SEND", { destination: "/topic/devices/alpha/in", receipt: "send-1" }, "hello"));
    await receipt;

    expect(inbound).toHaveBeenCalledTimes(1);
    expect(inbound.mock.calls[0][0]).toMatchObject({
      agentId: "iot-agent",
      destination: "/topic/devices/alpha/in",
      replyDestination: "/topic/devices/reply",
      rawPayload: "hello",
    });
    client.destroy();
  });

  it("enforces client-individual prefetch and ACK", async () => {
    config = { ...config, prefetchCount: 1 };
    await startStompTcpServer(config, vi.fn());
    const client = await connectClient(config);
    await stompConnect(client);
    const subscribed = readUntil(client, "receipt-id:sub-1-ready");
    client.write(frame("SUBSCRIBE", { id: "sub-1", destination: "/topic/demo", ack: "client-individual", "prefetch-count": "1", receipt: "sub-1-ready" }));
    await subscribed;

    publishToDestination("/topic/demo", "m1");
    publishToDestination("/topic/demo", "m2");
    const first = await readUntil(client, "m1");
    expect(first).not.toContain("m2");
    const ackId = /\nack:([^\n]+)/.exec(first)?.[1];
    expect(ackId).toBeTruthy();

    const second = readUntil(client, "m2");
    client.write(frame("ACK", { id: ackId ?? "" }));
    await expect(second).resolves.toContain("MESSAGE");
    client.destroy();
  });

  it("requeues NACK deliveries and marks them redelivered", async () => {
    config = { ...config, prefetchCount: 1 };
    await startStompTcpServer(config, vi.fn());
    const client = await connectClient(config);
    await stompConnect(client);
    const subscribed = readUntil(client, "receipt-id:sub-2-ready");
    client.write(frame("SUBSCRIBE", { id: "sub-2", destination: "/topic/nack", ack: "client-individual", "prefetch-count": "1", receipt: "sub-2-ready" }));
    await subscribed;

    publishToDestination("/topic/nack", "redeliver-me");
    const first = await readUntil(client, "redeliver-me");
    const ackId = /\nack:([^\n]+)/.exec(first)?.[1];
    const redelivery = readUntil(client, "redelivered:true");
    client.write(frame("NACK", { id: ackId ?? "", requeue: "true" }));
    await expect(redelivery).resolves.toContain("redeliver-me");
    client.destroy();
  });

  it("implements cumulative ACK for ack=client", async () => {
    config = { ...config, prefetchCount: 2 };
    await startStompTcpServer(config, vi.fn());
    const client = await connectClient(config);
    await stompConnect(client);
    const subscribed = readUntil(client, "receipt-id:cumulative-ready");
    client.write(frame("SUBSCRIBE", { id: "cumulative", destination: "/topic/cumulative", ack: "client", "prefetch-count": "2", receipt: "cumulative-ready" }));
    await subscribed;
    publishToDestination("/topic/cumulative", "first");
    publishToDestination("/topic/cumulative", "second");
    publishToDestination("/topic/cumulative", "third");
    const deliveries = await readUntil(client, "second");
    expect(deliveries).not.toContain("third");
    const ackIds = [...deliveries.matchAll(/\nack:([^\n]+)/g)].map((match) => match[1]);
    expect(ackIds).toHaveLength(2);
    const third = readUntil(client, "third");
    client.write(frame("ACK", { id: ackIds[1] }));
    await expect(third).resolves.toContain("third");
    client.destroy();
  });
});

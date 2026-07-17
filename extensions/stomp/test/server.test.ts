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
  it("does not expose internal Agent errors through SEND or transaction COMMIT", async () => {
    const logger = { error: vi.fn() };
    const secret = "stomp-production-secret";
    const inbound = vi.fn().mockRejectedValue(new Error(
      `Agent unavailable tls://user:password@internal?access_token=${secret}`,
    ));
    await startStompTcpServer(config, inbound, logger);
    const client = await connectClient(config);
    await stompConnect(client);

    const sendError = readUntil(client, "Agent dispatch failed");
    client.write(frame("SEND", { destination: "/queue/agent", receipt: "send-secret" }, "direct"));
    const directResponse = await sendError;
    expect(directResponse).not.toMatch(/stomp-production-secret|user:password|Agent unavailable/);
    expect(directResponse).not.toContain("RECEIPT\nreceipt-id:send-secret");

    client.write(frame("BEGIN", { transaction: "tx-secret" }));
    client.write(frame("SEND", { destination: "/queue/agent", transaction: "tx-secret" }, "transactional"));
    const commitError = readUntil(client, "Agent dispatch failed");
    client.write(frame("COMMIT", { transaction: "tx-secret", receipt: "commit-secret" }));
    const commitResponse = await commitError;
    expect(commitResponse).not.toMatch(/stomp-production-secret|user:password|Agent unavailable/);
    expect(commitResponse).not.toContain("RECEIPT\nreceipt-id:commit-secret");

    const logs = JSON.stringify(logger.error.mock.calls);
    expect(logs).not.toMatch(/stomp-production-secret|user:password/);
    expect(logs).toContain("[REDACTED]");
    client.destroy();
  });

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

  it("buffers transactional SEND until COMMIT and discards it on ABORT", async () => {
    const inbound = vi.fn<(message: InboundMessage) => Promise<void>>().mockResolvedValue(undefined);
    await startStompTcpServer(config, inbound);
    const client = await connectClient(config);
    await stompConnect(client);

    const begun = readUntil(client, "receipt-id:begin-1");
    client.write(frame("BEGIN", { transaction: "tx-1", receipt: "begin-1" }));
    await begun;
    const queued = readUntil(client, "receipt-id:queued-1");
    client.write(frame("SEND", { destination: "/queue/agent", transaction: "tx-1", receipt: "queued-1" }, "committed"));
    await queued;
    expect(inbound).not.toHaveBeenCalled();

    const committed = readUntil(client, "receipt-id:commit-1");
    client.write(frame("COMMIT", { transaction: "tx-1", receipt: "commit-1" }));
    await committed;
    expect(inbound).toHaveBeenCalledTimes(1);
    expect(inbound.mock.calls[0][0]).toMatchObject({ rawPayload: "committed", idempotencyKey: undefined });

    const begunAbort = readUntil(client, "receipt-id:begin-2");
    client.write(frame("BEGIN", { transaction: "tx-2", receipt: "begin-2" }));
    await begunAbort;
    client.write(frame("SEND", { destination: "/queue/agent", transaction: "tx-2" }, "aborted"));
    const aborted = readUntil(client, "receipt-id:abort-2");
    client.write(frame("ABORT", { transaction: "tx-2", receipt: "abort-2" }));
    await aborted;
    expect(inbound).toHaveBeenCalledTimes(1);
    client.destroy();
  });

  it("按连接限制全部事务动作总数，避免多事务平方级膨胀", async () => {
    config = { ...config, maxPendingMessages: 2 };
    await startStompTcpServer(config, vi.fn());
    const client = await connectClient(config);
    await stompConnect(client);
    for (const [command, headers, body, receipt] of [
      ["BEGIN", { transaction: "tx-a", receipt: "begin-a" }, "", "begin-a"],
      ["BEGIN", { transaction: "tx-b", receipt: "begin-b" }, "", "begin-b"],
      ["SEND", { destination: "/queue/agent", transaction: "tx-a", receipt: "send-a" }, "one", "send-a"],
      ["SEND", { destination: "/queue/agent", transaction: "tx-b", receipt: "send-b" }, "two", "send-b"],
    ] as const) {
      const acknowledged = readUntil(client, `receipt-id:${receipt}`);
      client.write(frame(command, headers, body));
      await acknowledged;
    }
    const rejected = readUntil(client, "Connection transaction action limit exceeded");
    client.write(frame("SEND", { destination: "/queue/agent", transaction: "tx-a" }, "three"));
    await expect(rejected).resolves.toContain("ERROR");
    client.destroy();
  });

  it("停机时等待已经进入 Agent 管道的帧完成", async () => {
    let release!: () => void;
    const inbound = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    config.shutdownTimeoutMs = 1_000;
    await startStompTcpServer(config, inbound);
    const client = await connectClient(config);
    await stompConnect(client);
    client.write(frame("SEND", { destination: "/queue/agent" }, "drain-me"));
    await vi.waitFor(() => expect(inbound).toHaveBeenCalledTimes(1));

    let stopped = false;
    const stopping = stopStompTcpServer().then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it("defers transactional ACK until COMMIT releases prefetch", async () => {
    config = { ...config, prefetchCount: 1 };
    await startStompTcpServer(config, vi.fn());
    const client = await connectClient(config);
    await stompConnect(client);
    const subscribed = readUntil(client, "receipt-id:tx-sub-ready");
    client.write(frame("SUBSCRIBE", { id: "tx-sub", destination: "/topic/tx-ack", ack: "client-individual", receipt: "tx-sub-ready" }));
    await subscribed;
    publishToDestination("/topic/tx-ack", "first-tx");
    publishToDestination("/topic/tx-ack", "second-tx");
    const first = await readUntil(client, "first-tx");
    const ackId = /\nack:([^\n]+)/.exec(first)?.[1];

    client.write(frame("BEGIN", { transaction: "ack-tx" }));
    const ackQueued = readUntil(client, "receipt-id:ack-queued");
    client.write(frame("ACK", { id: ackId ?? "", transaction: "ack-tx", receipt: "ack-queued" }));
    await ackQueued;
    await new Promise((resolve) => setTimeout(resolve, 25));
    const second = readUntil(client, "second-tx");
    client.write(frame("COMMIT", { transaction: "ack-tx" }));
    await expect(second).resolves.toContain("MESSAGE");
    client.destroy();
  });

  it("delivers identical unkeyed SEND frames independently and keeps the first duplicate header", async () => {
    const inbound = vi.fn<(message: InboundMessage) => Promise<void>>().mockResolvedValue(undefined);
    await startStompTcpServer(config, inbound);
    const client = await connectClient(config);
    await stompConnect(client);
    client.write("SEND\ndestination:/queue/agent\ndestination:/queue/agent.forbidden\n\nsame-body\0");
    client.write(frame("SEND", { destination: "/queue/agent" }, "same-body"));
    await vi.waitFor(() => expect(inbound).toHaveBeenCalledTimes(2));
    expect(inbound.mock.calls.map(([message]) => message.idempotencyKey)).toEqual([undefined, undefined]);
    expect(inbound.mock.calls.every(([message]) => message.destination === "/queue/agent")).toBe(true);
    client.destroy();
  });
});

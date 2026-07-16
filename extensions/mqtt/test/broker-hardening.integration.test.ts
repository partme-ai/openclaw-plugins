import { createServer } from "node:net";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import * as mqtt from "mqtt";
import { afterEach, describe, expect, it } from "vitest";

import { getBrokerStats, getClientUsername, startBroker, stopBroker } from "../src/transport/server.js";
import type { MqttBrokerConfig } from "../src/types.js";

const execFileAsync = promisify(execFile);

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to allocate a test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function config(port: number, overrides: Partial<MqttBrokerConfig> = {}): MqttBrokerConfig {
  return {
    host: "127.0.0.1",
    port,
    maxConnections: 10,
    auth: { enabled: false, allowAnonymous: false, users: [] },
    tls: { enabled: false, port: 8883 },
    limits: {
      maxPayloadBytes: 1024,
      maxPendingMessagesPerClient: 8,
      inboundTaskTimeoutMs: 5_000,
    },
    session: { maxExpirySeconds: 60, persistentAcrossReconnect: true },
    qos0: { mailboxSoftLimit: 10 },
    retain: { allowInboundRetain: true, outboundRetain: false },
    audit: { enabled: false, format: "json" },
    will: { allow: true, allowedTopicPatterns: [] },
    persistence: { enabled: false, backend: "memory" },
    subscribeTopics: [],
    payload: { mode: "jsonTextOrPlain" },
    ...overrides,
  };
}

async function connect(port: number, options: mqtt.IClientOptions): Promise<mqtt.MqttClient> {
  const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
    reconnectPeriod: 0,
    connectTimeout: 3_000,
    ...options,
  });
  await new Promise<void>((resolve, reject) => {
    client.once("connect", () => resolve());
    client.once("error", reject);
  });
  return client;
}

describe.sequential("MQTT broker production hardening", () => {
  afterEach(async () => {
    await stopBroker().catch(() => undefined);
  });

  it("rejects a second start and remains usable", async () => {
    const port = await freePort();
    const brokerConfig = config(port);
    await startBroker(brokerConfig, () => undefined);

    await expect(startBroker(brokerConfig, () => undefined)).rejects.toThrow(/already running/i);
    const client = await connect(port, { clientId: "still-running", clean: true });
    expect(getBrokerStats().running).toBe(true);
    await client.endAsync();
  });

  it("cleans up a partial TLS startup failure so a later start succeeds", async () => {
    const port = await freePort();
    const tlsPort = await freePort();
    await expect(startBroker(config(port, {
      tls: {
        enabled: true,
        port: tlsPort,
        certFile: "/definitely/missing/cert.pem",
        keyFile: "/definitely/missing/key.pem",
      },
    }), () => undefined)).rejects.toThrow();

    expect(getBrokerStats().running).toBe(false);
    await startBroker(config(port), () => undefined);
    const client = await connect(port, { clientId: "after-failed-start", clean: true });
    await client.endAsync();
  });

  it("preserves the replacement connection identity for duplicate clientId takeover", async () => {
    const port = await freePort();
    const inbound: string[] = [];
    await startBroker(config(port, {
      maxConnections: 1,
      auth: {
        enabled: true,
        allowAnonymous: false,
        users: [
          { username: "alice", password: "alice-pass", publishAllow: ["alice/#"], subscribeAllow: ["alice/#"] },
          { username: "bob", password: "bob-pass", publishAllow: ["bob/#"], subscribeAllow: ["bob/#"] },
        ],
      },
    }), async (message) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      inbound.push(message.topic);
    });

    const first = await connect(port, {
      clientId: "shared-id", username: "alice", password: "alice-pass", clean: true,
    });
    first.on("error", () => undefined);
    const replacement = await connect(port, {
      clientId: "shared-id", username: "bob", password: "bob-pass", clean: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(getClientUsername("shared-id")).toBe("bob");
    expect(getBrokerStats().connectedClients).toBe(1);
    await replacement.publishAsync("bob/allowed", "ok", { qos: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(inbound).toContain("bob/allowed");
    await replacement.endAsync();
    first.end(true);
  });

  it("rejects oversized and retained publishes before subscribers or OpenClaw receive them", async () => {
    const port = await freePort();
    const inbound: string[] = [];
    const delivered: string[] = [];
    await startBroker(config(port, {
      limits: {
        maxPayloadBytes: 4,
        maxPendingMessagesPerClient: 8,
        inboundTaskTimeoutMs: 5_000,
      },
      retain: { allowInboundRetain: false, outboundRetain: false },
    }), (message) => { inbound.push(message.topic); });
    const subscriber = await connect(port, { clientId: "policy-sub", clean: true });
    subscriber.on("message", (topic) => delivered.push(topic));
    await subscriber.subscribeAsync("policy/#");
    const publisher = await connect(port, { clientId: "policy-pub", clean: true });
    publisher.on("error", () => undefined);

    publisher.publish("policy/oversized", "12345", { qos: 0 });
    publisher.publish("policy/retained", "ok", { qos: 0, retain: true });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(inbound).toEqual([]);
    expect(delivered).toEqual([]);
    await subscriber.endAsync();
    publisher.end(true);
  });

  it("contains asynchronous inbound handler failures and releases QoS0 inflight state", async () => {
    const port = await freePort();
    const unhandled: unknown[] = [];
    const listener = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", listener);
    try {
      await startBroker(config(port), async () => {
        await Promise.resolve();
        throw new Error("expected handler failure");
      });
      const publisher = await connect(port, { clientId: "rejecting-handler", clean: true });
      publisher.publish("handler/failure", "ok", { qos: 0 });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(unhandled).toEqual([]);
      expect(getBrokerStats().qos0InflightClients).toBe(0);
      await publisher.endAsync();
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  it("serializes one client while allowing different clients to run in parallel", async () => {
    const port = await freePort();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });

    await startBroker(config(port), async (message) => {
      const marker = message.payload;
      events.push(`${marker}:start`);
      if (marker === "a1") {
        markFirstStarted?.();
        await firstGate;
      }
      events.push(`${marker}:end`);
    });

    const clientA = await connect(port, { clientId: "ordered-a", clean: true });
    const clientB = await connect(port, { clientId: "parallel-b", clean: true });
    const publishA1 = clientA.publishAsync("queue/a", "a1", { qos: 1 });
    await firstStarted;
    const publishA2 = clientA.publishAsync("queue/a", "a2", { qos: 1 });
    await clientB.publishAsync("queue/b", "b1", { qos: 1 });

    expect(events).toEqual(["a1:start", "b1:start", "b1:end"]);
    expect(getBrokerStats()).toMatchObject({ inboundActive: 1, inboundQueued: 1 });

    releaseFirst?.();
    await Promise.all([publishA1, publishA2]);
    expect(events).toEqual([
      "a1:start",
      "b1:start",
      "b1:end",
      "a1:end",
      "a2:start",
      "a2:end",
    ]);
    await Promise.all([clientA.endAsync(), clientB.endAsync()]);
  });

  it("accepts a real MQTT-over-TLS connection and a QoS 2 publish", async () => {
    const directory = await mkdtemp(join(tmpdir(), "openclaw-mqtt-tls-"));
    const certFile = join(directory, "server.pem");
    const keyFile = join(directory, "server.key");
    try {
      await execFileAsync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", keyFile, "-out", certFile,
        "-subj", "/CN=localhost", "-days", "1",
        "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ]);
      const tlsPort = await freePort();
      const received: Array<{ topic: string; qos: number }> = [];
      await startBroker(config(0, {
        tls: { enabled: true, port: tlsPort, certFile, keyFile },
      }), (message) => { received.push({ topic: message.topic, qos: message.qos }); });

      const client = mqtt.connect(`mqtts://127.0.0.1:${tlsPort}`, {
        clientId: "tls-qos2",
        clean: true,
        reconnectPeriod: 0,
        rejectUnauthorized: false,
      });
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await client.publishAsync("tls/qos2", "secure", { qos: 2 });
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(received).toContainEqual({ topic: "tls/qos2", qos: 2 });
      await client.endAsync();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);

  it.each(["level"] as const)(
    "starts and delivers messages with the %s persistence adapter",
    async (backend) => {
      const directory = await mkdtemp(join(tmpdir(), `openclaw-mqtt-${backend}-`));
      try {
        const port = await freePort();
        const received: string[] = [];
        await startBroker(
          config(port, {
            persistence: {
              enabled: true,
              backend,
              level: { path: join(directory, "level") },
            },
          }),
          (message) => received.push(message.payload.toString("utf8")),
        );
        const client = await connect(port, {
          clientId: `${backend}-persistence`,
          clean: false,
        });
        await client.publishAsync("persistence/test", backend, { qos: 1 });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(received).toContain(backend);
        await client.endAsync();
      } finally {
        await stopBroker().catch(() => undefined);
        await rm(directory, { recursive: true, force: true });
      }
    },
    15_000,
  );
});

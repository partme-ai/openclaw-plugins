import { createServer } from "node:net";

import mqtt from "mqtt";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startBroker, stopBroker } from "../src/transport/server.js";

const redisUrl = process.env.TEST_REDIS_URL;
const suite = redisUrl ? describe : describe.skip;
let port = 0;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to reserve TCP port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

suite("MQTT Redis persistence", () => {
  beforeAll(async () => {
    const redis = new URL(redisUrl as string);
    port = await freePort();
    await startBroker({
      host: "127.0.0.1",
      port,
      maxConnections: 10,
      auth: {
        enabled: true,
        allowAnonymous: false,
        users: [{ username: "redis-user", password: "redis-pass", publishAllow: ["test/#"], subscribeAllow: ["test/#"] }],
      },
      tls: { enabled: false, port: 0 },
      limits: { maxPayloadBytes: 1024 },
      session: { maxExpirySeconds: 60, persistentAcrossReconnect: true },
      qos0: { mailboxSoftLimit: 20 },
      retain: { allowInboundRetain: true, outboundRetain: false },
      audit: { enabled: false, format: "json" },
      will: { allow: false, allowedTopicPatterns: [] },
      persistence: {
        enabled: true,
        backend: "redis",
        redis: {
          enabled: true,
          host: redis.hostname,
          port: Number(redis.port),
          db: Number(redis.pathname.slice(1) || 0),
          password: redis.password || undefined,
          keyPrefix: `test-mqtt-${Date.now()}`,
          packetTTL: 60,
        },
      },
      subscribeTopics: ["test/#"],
      payload: { mode: "jsonTextOrPlain" },
    }, () => undefined);
  });

  afterAll(async () => { await stopBroker(); });

  it("starts with Redis and delivers an authenticated message", async () => {
    const client = mqtt.connect(`mqtt://127.0.0.1:${port}`, {
      username: "redis-user",
      password: "redis-pass",
      reconnectPeriod: 0,
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    const received = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Redis MQTT delivery timed out")), 5_000);
      client.once("message", (_topic, payload) => {
        clearTimeout(timeout);
        resolve(payload.toString());
      });
    });
    await client.subscribeAsync("test/redis");
    await client.publishAsync("test/redis", "ok", { qos: 1 });
    expect(await received).toBe("ok");
    await client.endAsync();
  });
});

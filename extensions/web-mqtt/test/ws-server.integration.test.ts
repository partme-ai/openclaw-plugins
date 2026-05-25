/**
 * Web MQTT 服务器集成测试（WebSocket + Aedes broker）。
 */

import mqtt from "mqtt";
import { afterEach, describe, expect, it, vi } from "vitest";

import { publishToTopic, startWebMqttServer, stopWebMqttServer } from "../src/transport/server.js";
import type { WebMqttConfig } from "../src/types.js";

const baseConfig: WebMqttConfig = {
  port: 35675,
  path: "/ws",
  host: "127.0.0.1",
  maxConnections: 100,
  topicPrefix: "openclaw/",
  subscribeTopics: [],
  topicBindings: [],
  payload: { mode: "jsonTextOrPlain" },
  auth: { required: false, allowAnonymous: true, users: [] },
  tls: {
    enabled: false,
    minVersion: "TLSv1.2",
    requestCert: false,
    rejectUnauthorized: false,
  },
  ws: { compress: false, idleTimeoutMs: 60_000, maxFrameSize: 256 * 1024 },
  limits: { maxPayloadBytes: 1024 * 1024, maxSubscriptionsPerClient: 50 },
  proxyProtocol: false,
};

afterEach(async () => {
  await stopWebMqttServer();
});

describe("web-mqtt ws-server integration", () => {
  it("should accept publish and invoke inbound handler", async () => {
    const inboundSpy = vi.fn();
    await startWebMqttServer(baseConfig, inboundSpy);

    const brokerUrl = `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`;
    const client = mqtt.connect(brokerUrl, {
      clientId: `vitest-${Date.now()}`,
      reconnectPeriod: 0,
      connectTimeout: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("error", reject);
    });

    const topic = "openclaw/agent/test-bot/in";
    const payload = JSON.stringify({ text: "hello mqtt ws" });
    await new Promise<void>((resolve, reject) => {
      client.publish(topic, payload, (err) => (err ? reject(err) : resolve()));
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    client.end(true);

    expect(inboundSpy).toHaveBeenCalledTimes(1);
    expect(inboundSpy.mock.calls[0][0]).toMatchObject({
      topic,
      clientId: expect.any(String),
    });
    expect(inboundSpy.mock.calls[0][0].payload.toString("utf-8")).toBe(payload);
  });

  it("publishToTopic should deliver to subscribed client", async () => {
    await startWebMqttServer(baseConfig, vi.fn());

    const brokerUrl = `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`;
    const replyTopic = "openclaw/agent/test-bot/out";
    const client = mqtt.connect(brokerUrl, {
      clientId: `vitest-sub-${Date.now()}`,
      reconnectPeriod: 0,
    });

    await new Promise<void>((resolve, reject) => {
      client.once("connect", () => resolve());
      client.once("error", reject);
    });

    const received: string[] = [];
    await new Promise<void>((resolve, reject) => {
      client.subscribe(replyTopic, (err) => (err ? reject(err) : resolve()));
    });
    client.on("message", (_topic, payload) => {
      received.push(payload.toString("utf-8"));
    });

    await publishToTopic(replyTopic, "outbound-from-server");
    await new Promise((resolve) => setTimeout(resolve, 150));
    client.end(true);

    expect(received).toContain("outbound-from-server");
  });
});

/**
 * Web MQTT 服务器集成测试（WebSocket + Aedes broker）。
 */

import mqtt from "mqtt";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  ws: { compress: false, idleTimeoutMs: 60_000, maxFrameSize: 256 * 1024, allowedOrigins: [] },
  limits: { maxPayloadBytes: 256 * 1024, maxSubscriptionsPerClient: 50 },
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

  it("should enforce authenticated user ACLs", async () => {
    await startWebMqttServer({
      ...baseConfig,
      auth: {
        required: true,
        allowAnonymous: false,
        users: [{
          username: "browser-user",
          password: "secret",
          publishAllow: ["allowed/+/in"],
          subscribeAllow: ["allowed/+/out"],
        }],
      },
      limits: { ...baseConfig.limits, maxSubscriptionsPerClient: 1 },
    }, vi.fn());

    const client = mqtt.connect(`ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`, {
      username: "browser-user",
      password: "secret",
      reconnectPeriod: 0,
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    const granted = await client.subscribeAsync("allowed/device/out");
    expect(granted[0]?.qos).toBe(0);
    await expect(client.subscribeAsync("admin/#")).rejects.toThrow("Subscribe error");
    await expect(client.subscribeAsync("allowed/other/out")).rejects.toThrow("Subscribe error");
    await client.endAsync();
  });

  it("should reject a browser Origin outside the allowlist", async () => {
    await startWebMqttServer({
      ...baseConfig,
      ws: { ...baseConfig.ws, allowedOrigins: ["https://console.example.com"] },
    }, vi.fn());
    const socket = new WebSocket(
      `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`,
      "mqtt",
      { origin: "https://evil.example.com" },
    );
    const status = await new Promise<number>((resolve, reject) => {
      socket.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      socket.once("open", () => reject(new Error("unexpected WebSocket acceptance")));
      socket.once("error", () => undefined);
    });
    expect(status).toBe(403);
  });

  it("should enforce the WebSocket connection limit", async () => {
    await startWebMqttServer({ ...baseConfig, maxConnections: 1 }, vi.fn());
    const first = mqtt.connect(`ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`, {
      reconnectPeriod: 0,
    });
    await new Promise<void>((resolve, reject) => {
      first.once("connect", resolve);
      first.once("error", reject);
    });

    const second = new WebSocket(`ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`, "mqtt");
    const status = await new Promise<number>((resolve, reject) => {
      second.once("unexpected-response", (_request, response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      second.once("open", () => reject(new Error("connection limit was not enforced")));
      second.once("error", () => undefined);
    });
    expect(status).toBe(503);
    await first.endAsync();
  });

  it("should accept a real WSS MQTT connection", async () => {
    const certDir = mkdtempSync(join(tmpdir(), "openclaw-web-mqtt-"));
    const keyFile = join(certDir, "server.key");
    const certFile = join(certDir, "server.crt");
    try {
      execFileSync("openssl", [
        "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", keyFile, "-out", certFile, "-days", "1",
        "-subj", "/CN=127.0.0.1",
      ], { stdio: "ignore" });
      expect(readFileSync(certFile, "utf-8")).toContain("BEGIN CERTIFICATE");
      await startWebMqttServer({
        ...baseConfig,
        tls: { ...baseConfig.tls, enabled: true, keyFile, certFile },
      }, vi.fn());
      const client = mqtt.connect(`wss://127.0.0.1:${baseConfig.port}${baseConfig.path}`, {
        reconnectPeriod: 0,
        rejectUnauthorized: false,
      });
      await new Promise<void>((resolve, reject) => {
        client.once("connect", resolve);
        client.once("error", reject);
      });
      await client.endAsync();
    } finally {
      rmSync(certDir, { recursive: true, force: true });
    }
  });
});

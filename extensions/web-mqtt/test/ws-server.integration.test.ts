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

import {
  getClientUsername,
  getStats,
  publishToTopic,
  startWebMqttServer,
  stopWebMqttServer,
} from "../src/transport/server.js";
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
  limits: {
    maxPayloadBytes: 256 * 1024,
    maxSubscriptionsPerClient: 50,
    maxPendingMessagesPerClient: 8,
    inboundTaskTimeoutMs: 5_000,
  },
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

  it("should defer QoS 1 PUBACK until the Agent handler completes", async () => {
    let releaseHandler: (() => void) | undefined;
    const handler = vi.fn(() => new Promise<void>((resolve) => {
      releaseHandler = resolve;
    }));
    await startWebMqttServer(baseConfig, handler);
    const client = mqtt.connect(`ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`, {
      clientId: `vitest-qos-${Date.now()}`,
      reconnectPeriod: 0,
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });

    let acknowledged = false;
    const published = client.publishAsync(
      "openclaw/agent/test-bot/in",
      JSON.stringify({ text: "wait for Agent" }),
      { qos: 1 },
    ).then(() => { acknowledged = true; });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(acknowledged).toBe(false);

    releaseHandler?.();
    await published;
    expect(acknowledged).toBe(true);
    await client.endAsync();
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

    expect(await publishToTopic(replyTopic, "outbound-from-server")).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    client.end(true);

    expect(received).toContain("outbound-from-server");
  });

  it("publishToTopic should report zero when no active subscriber matches", async () => {
    await startWebMqttServer(baseConfig, vi.fn());
    expect(await publishToTopic("openclaw/agent/nobody/out", "lost")).toBe(0);
  });

  it("publishToTopic should reject wildcard Topic Names", async () => {
    await startWebMqttServer(baseConfig, vi.fn());
    await expect(publishToTopic("openclaw/agent/+/out", "invalid")).rejects.toThrow(
      "Invalid outbound MQTT Topic Name",
    );
  });

  it("should serialize one client while different clients run in parallel", async () => {
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const handler = vi.fn(async (event: { payload: Buffer }) => {
      const label = event.payload.toString("utf-8");
      started.push(label);
      if (label === "a-1" || label === "b-1") {
        await new Promise<void>((resolve) => releases.set(label, resolve));
      }
    });
    await startWebMqttServer(baseConfig, handler);
    const url = `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`;
    const clientA = mqtt.connect(url, { clientId: "fifo-a", reconnectPeriod: 0 });
    const clientB = mqtt.connect(url, { clientId: "fifo-b", reconnectPeriod: 0 });
    await Promise.all([
      new Promise<void>((resolve, reject) => { clientA.once("connect", resolve); clientA.once("error", reject); }),
      new Promise<void>((resolve, reject) => { clientB.once("connect", resolve); clientB.once("error", reject); }),
    ]);

    const firstA = clientA.publishAsync("openclaw/agent/main/in", "a-1", { qos: 1 });
    const secondA = clientA.publishAsync("openclaw/agent/main/in", "a-2", { qos: 1 });
    const firstB = clientB.publishAsync("openclaw/agent/main/in", "b-1", { qos: 1 });
    await vi.waitFor(() => expect(started).toEqual(expect.arrayContaining(["a-1", "b-1"])));
    expect(started).not.toContain("a-2");
    expect(getStats()).toMatchObject({ inboundActive: 2, inboundQueued: 1 });

    releases.get("b-1")?.();
    await firstB;
    expect(started).not.toContain("a-2");
    releases.get("a-1")?.();
    await Promise.all([firstA, secondA]);
    expect(started.indexOf("a-2")).toBeGreaterThan(started.indexOf("a-1"));
    await Promise.all([clientA.endAsync(), clientB.endAsync()]);
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
    expect(getStats().rejectedConnections).toBe(1);
  });

  it("should accept an exact browser Origin from the allowlist", async () => {
    await startWebMqttServer({
      ...baseConfig,
      ws: { ...baseConfig.ws, allowedOrigins: ["https://console.example.com"] },
    }, vi.fn());
    const socket = new WebSocket(
      `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`,
      "mqtt",
      { origin: "https://console.example.com" },
    );
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    socket.close();
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
    expect(getStats().rejectedConnections).toBe(1);
    await first.endAsync();
  });

  it("should terminate a silent connection after the configured idle timeout", async () => {
    await startWebMqttServer({
      ...baseConfig,
      ws: { ...baseConfig.ws, idleTimeoutMs: 100 },
    }, vi.fn());
    const client = mqtt.connect(`ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`, {
      clientId: "idle-client",
      reconnectPeriod: 0,
      keepalive: 0,
    });
    await new Promise<void>((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("idle connection was not terminated")), 2_000);
      client.once("close", () => { clearTimeout(timer); resolve(); });
    });
    await vi.waitFor(() => expect(getStats().connectedClients).toBe(0));
  });

  it("should accept a new connection and publish after the same clientId reconnects", async () => {
    const inboundSpy = vi.fn();
    await startWebMqttServer(baseConfig, inboundSpy);
    const url = `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`;
    const first = mqtt.connect(url, { clientId: "reconnect-client", reconnectPeriod: 0 });
    await new Promise<void>((resolve, reject) => { first.once("connect", resolve); first.once("error", reject); });
    await first.endAsync();
    await vi.waitFor(() => expect(getStats().connectedClients).toBe(0));

    const second = mqtt.connect(url, { clientId: "reconnect-client", reconnectPeriod: 0 });
    await new Promise<void>((resolve, reject) => { second.once("connect", resolve); second.once("error", reject); });
    await second.publishAsync("openclaw/agent/main/in", "after-reconnect", { qos: 1 });
    expect(inboundSpy).toHaveBeenCalledWith(expect.objectContaining({
      clientId: "reconnect-client",
      topic: "openclaw/agent/main/in",
    }));
    await second.endAsync();
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

  it("should reject oversized publishes before subscribers and OpenClaw receive them", async () => {
    const inboundSpy = vi.fn();
    await startWebMqttServer({
      ...baseConfig,
      limits: { ...baseConfig.limits, maxPayloadBytes: 4 },
    }, inboundSpy);
    const url = `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`;
    const subscriber = mqtt.connect(url, { clientId: "size-sub", reconnectPeriod: 0 });
    const publisher = mqtt.connect(url, { clientId: "size-pub", reconnectPeriod: 0 });
    publisher.on("error", () => undefined);
    await Promise.all([
      new Promise<void>((resolve, reject) => { subscriber.once("connect", resolve); subscriber.once("error", reject); }),
      new Promise<void>((resolve, reject) => { publisher.once("connect", resolve); publisher.once("error", reject); }),
    ]);
    const delivered: string[] = [];
    subscriber.on("message", (topic) => delivered.push(topic));
    await subscriber.subscribeAsync("policy/#");
    publisher.publish("policy/oversized", "12345", { qos: 0 });
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(inboundSpy).not.toHaveBeenCalled();
    expect(delivered).toEqual([]);
    expect(getStats().droppedMessages).toBeGreaterThanOrEqual(1);
    await subscriber.endAsync();
    publisher.end(true);
  });

  it("should preserve the replacement identity when a duplicate clientId takes over", async () => {
    const inboundSpy = vi.fn();
    await startWebMqttServer({
      ...baseConfig,
      maxConnections: 2,
      auth: {
        required: true,
        allowAnonymous: false,
        users: [
          { username: "alice", password: "alice-pass", publishAllow: ["alice/#"] },
          { username: "bob", password: "bob-pass", publishAllow: ["bob/#"] },
        ],
      },
    }, inboundSpy);
    const url = `ws://127.0.0.1:${baseConfig.port}${baseConfig.path}`;
    const first = mqtt.connect(url, {
      clientId: "shared-web-id", username: "alice", password: "alice-pass", reconnectPeriod: 0,
    });
    first.on("error", () => undefined);
    await new Promise<void>((resolve, reject) => { first.once("connect", resolve); first.once("error", reject); });
    const replacement = mqtt.connect(url, {
      clientId: "shared-web-id", username: "bob", password: "bob-pass", reconnectPeriod: 0,
    });
    await new Promise<void>((resolve, reject) => { replacement.once("connect", resolve); replacement.once("error", reject); });
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(getClientUsername("shared-web-id")).toBe("bob");
    expect(getStats().connectedClients).toBe(1);
    await replacement.publishAsync("bob/allowed", "ok", { qos: 1 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(inboundSpy).toHaveBeenCalledWith(expect.objectContaining({ topic: "bob/allowed" }));
    await replacement.endAsync();
    first.end(true);
  });

  it("should clean up after a TLS startup failure and allow a later start", async () => {
    await expect(startWebMqttServer({
      ...baseConfig,
      tls: {
        ...baseConfig.tls,
        enabled: true,
        keyFile: "/definitely/missing/server.key",
        certFile: "/definitely/missing/server.crt",
      },
    }, vi.fn())).rejects.toThrow();
    expect(getStats().brokerReady).toBe(false);

    await startWebMqttServer(baseConfig, vi.fn());
    expect(getStats().brokerReady).toBe(true);
  });
});

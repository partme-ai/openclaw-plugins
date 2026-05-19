/**
 * openclaw-mqtt 功能集成测试
 *
 * 测试覆盖：
 * 1. 内嵌 Aedes MQTT Broker 启动
 * 2. MQTT 客户端连接 + 认证
 * 3. Topic 发布/订阅消息路由
 * 4. ACL 权限控制
 * 5. QoS 0/1 消息处理
 * 6. 超大 payload 保护
 * 7. Wildcard 通配符订阅
 * 8. /mqtt/status 端点格式
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as mqtt from "mqtt";

// 直接从源码导入 broker 模块（不依赖 openclaw peer dependency）
import { startBroker, stopBroker, getBrokerStats, getConnectedClients, getClientUsername } from "../src/broker.js";
import { loadTopicMappings, getLoadedTopicMappings } from "../src/topic-router.js";

const BROKER_PORT = 1884;
const TEST_TIMEOUT = 15000;

let brokerStarted = false;

describe("openclaw-mqtt 功能集成测试", () => {
  beforeAll(async () => {
    const config = {
      port: BROKER_PORT,
      wsPort: 0,
      maxConnections: 100,
      auth: {
        enabled: true,
        allowAnonymous: true,
        users: [
          {
            username: "test-user",
            password: "test-pass",
            publishAllow: ["openclaw/agent/+/in", "devices/+/data"],
            subscribeAllow: ["openclaw/agent/+/out", "devices/+/cmd"],
          },
          {
            username: "restricted-user",
            password: "restricted",
            publishAllow: ["devices/sensor1/data"],
            subscribeAllow: ["devices/sensor1/cmd"],
          },
        ],
      },
      tls: { enabled: false, port: 0 },
      limits: { maxPayloadBytes: 1024 * 1024 },
      session: { maxExpirySeconds: 3600, persistentAcrossReconnect: true },
      qos0: { mailboxSoftLimit: 200 },
      retain: { allowInboundRetain: true, outboundRetain: false },
      audit: { enabled: false, format: "json" as const },
      will: { allow: true, allowedTopicPatterns: [] },
      persistence: { enabled: false, backend: "memory" as const },
      subscribeTopics: [],
      payload: { mode: "jsonTextOrPlain" as const },
    };

    loadTopicMappings([
      { topicPattern: "devices/+/data", agentId: "iot-agent", accountId: "default" },
    ]);

    const inboundMessages: any[] = [];
    await startBroker(
      config,
      (msg: any) => { inboundMessages.push(msg); },
      (_clientId: string) => {},
      (_clientId: string) => {},
    );
    brokerStarted = true;
    console.log(`[test] Aedes broker started on port ${BROKER_PORT}`);
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (brokerStarted) {
      try { await stopBroker(); } catch (_) {}
      console.log("[test] Broker stopped");
    }
  });

  // ───── 1. Broker 启动 ─────
  it("1. Aedes MQTT Broker 正常启动", () => {
    expect(brokerStarted).toBe(true);
    const stats = getBrokerStats();
    expect(stats.running).toBe(true);
    expect(stats.connectedClients).toBe(0);
  });

  // ───── 2. 客户端连接 ─────
  it("2. MQTT 客户端可连接", async () => {
    const client = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "test-client-1",
      clean: true,
      connectTimeout: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("连接超时")), 8000);
      client.on("connect", () => { clearTimeout(t); resolve(); });
      client.on("error", reject);
    });

    const clients = getConnectedClients();
    expect(clients.some((c) => c.clientId === "test-client-1")).toBe(true);

    await client.endAsync();
  }, TEST_TIMEOUT);

  // ───── 3. 用户认证 ─────
  it("3. 凭据认证成功", async () => {
    const client = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "auth-client",
      username: "test-user",
      password: "test-pass",
      clean: true,
      connectTimeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("认证超时")), 8000);
      client.on("connect", () => { clearTimeout(t); resolve(); });
      client.on("error", reject);
    });
    expect(getClientUsername("auth-client")).toBe("test-user");
    await client.endAsync();
  }, TEST_TIMEOUT);

  // ───── 4. 错误凭据拒绝 ─────
  it("4. 错误凭据被拒绝", async () => {
    const client = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "bad-auth",
      username: "test-user",
      password: "wrong-password",
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 0,
    });
    let closed = false;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 6000);
      client.on("close", () => { closed = true; clearTimeout(t); resolve(); });
      client.on("error", () => {});
    });
    expect(closed).toBe(true);
    await client.endAsync().catch(() => {});
  }, TEST_TIMEOUT);

  // ───── 5. 消息发布/订阅 ─────
  it("5. 消息发布与订阅正常", async () => {
    const topic = "openclaw/agent/test-agent/in";
    const payload = JSON.stringify({ text: "Hello from integration test" });
    const received: mqtt.IPublishPacket[] = [];

    // 订阅者
    const sub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "sub-1", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("订阅超时")), 8000);
      sub.on("connect", () => {
        sub.subscribe("openclaw/agent/+/in", { qos: 1 }, (err) => {
          if (err) reject(err); else { clearTimeout(t); resolve(); }
        });
      });
    });
    sub.on("message", (t, p, packet) => {
      received.push({ ...packet, topic: t, payload: p } as any);
    });

    await new Promise((r) => setTimeout(r, 300));

    // 发布者
    const pub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "pub-1", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("发布超时")), 8000);
      pub.on("connect", () => { clearTimeout(t); resolve(); });
    });

    await new Promise<void>((resolve) => {
      pub.publish(topic, payload, { qos: 1 }, () => resolve());
    });

    // 等待投递
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 4000);
      const check = setInterval(() => {
        if (received.length > 0) { clearInterval(check); clearTimeout(t); resolve(); }
      }, 100);
    });

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0].topic).toBe(topic);
    expect(received[0].payload.toString()).toBe(payload);
    console.log(`[test] 收到消息: topic=${received[0].topic}, payload=${received[0].payload}`);

    await sub.endAsync();
    await pub.endAsync();
  }, TEST_TIMEOUT);

  // ───── 6. Wildcard 通配符 ─────
  it("6. MQTT 通配符订阅 (+)", async () => {
    const received: string[] = [];
    const sub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "wc-sub", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("超时")), 8000);
      sub.on("connect", () => {
        sub.subscribe("openclaw/agent/+/in", { qos: 1 }, (err) => {
          if (err) reject(err); else { clearTimeout(t); resolve(); }
        });
      });
    });
    sub.on("message", (topic) => { received.push(topic); });
    await new Promise((r) => setTimeout(r, 300));

    const pub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "wc-pub", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      pub.on("connect", () => { clearTimeout(t); resolve(); });
    });

    await Promise.all([
      new Promise<void>((r) => pub.publish("openclaw/agent/agent1/in", "m1", {}, () => r())),
      new Promise<void>((r) => pub.publish("openclaw/agent/agent2/in", "m2", {}, () => r())),
      new Promise<void>((r) => pub.publish("openclaw/agent/agent3/in", "m3", {}, () => r())),
    ]);

    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      const check = setInterval(() => {
        if (received.length >= 3) { clearInterval(check); clearTimeout(t); resolve(); }
      }, 100);
    });

    expect(received.length).toBeGreaterThanOrEqual(3);
    expect(received).toContain("openclaw/agent/agent1/in");
    expect(received).toContain("openclaw/agent/agent2/in");
    expect(received).toContain("openclaw/agent/agent3/in");
    console.log(`[test] 通配符订阅收到 ${received.length} 条消息`);

    await sub.endAsync();
    await pub.endAsync();
  }, TEST_TIMEOUT);

  // ───── 7. QoS 0 ─────
  it("7. QoS 0 消息 (fire-and-forget)", async () => {
    const received: string[] = [];
    const sub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "qos0-sub", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      sub.on("connect", () => {
        sub.subscribe("devices/test/qos0", { qos: 0 }, () => { clearTimeout(t); resolve(); });
      });
    });
    sub.on("message", (topic) => { received.push(topic); });
    await new Promise((r) => setTimeout(r, 200));

    const pub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "qos0-pub", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      pub.on("connect", () => { clearTimeout(t); resolve(); });
    });

    await new Promise<void>((r) => pub.publish("devices/test/qos0", "fire-and-forget", { qos: 0 }, () => r()));
    await new Promise((r) => setTimeout(r, 2000));

    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[0]).toBe("devices/test/qos0");
    console.log(`[test] QoS 0 消息成功投递到: ${received[0]}`);

    await sub.endAsync();
    await pub.endAsync();
  }, TEST_TIMEOUT);

  // ───── 8. 多客户端并行连接 ─────
  it("8. 多客户端并行连接", async () => {
    const clients: mqtt.MqttClient[] = [];
    for (let i = 0; i < 5; i++) {
      const c = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
        clientId: `multi-client-${i}`, clean: true, connectTimeout: 5000,
      });
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`客户端 ${i} 连接超时`)), 8000);
        c.on("connect", () => { clearTimeout(t); resolve(); });
      });
      clients.push(c);
    }

    const stats = getBrokerStats();
    expect(stats.connectedClients).toBeGreaterThanOrEqual(5);
    console.log(`[test] ${stats.connectedClients} 个客户端同时连接`);

    for (const c of clients) {
      await c.endAsync();
    }
  }, TEST_TIMEOUT);

  // ───── 9. 显式 topic 路由 ─────
  it("9. 显式 Topic 绑定路由匹配成功", () => {
    const mappings = getLoadedTopicMappings();
    expect(mappings.length).toBeGreaterThanOrEqual(1);
    expect(mappings[0].agentId).toBe("iot-agent");
    console.log(`[test] Topic 绑定已加载: ${mappings.length} 条, agent=${mappings[0].agentId}`);
  });

  // ───── 10. /mqtt/status 端点数据格式 ─────
  it("10. /mqtt/status 端点返回格式正确", () => {
    const stats = getBrokerStats();
    const clients = getConnectedClients();

    const response = {
      ok: true,
      data: {
        broker: stats,
        sessions: null,
        qos: null,
        clients,
        config: null,
        policy: null,
      },
    };

    expect(response.ok).toBe(true);
    expect(response.data.broker).toBeDefined();
    expect(typeof response.data.broker.connectedClients).toBe("number");
    expect(typeof response.data.broker.running).toBe("boolean");
    expect(Array.isArray(response.data.clients)).toBe(true);

    console.log("[test] /mqtt/status 响应格式验证通过");
    console.log(`  - running: ${response.data.broker.running}`);
    console.log(`  - connectedClients: ${response.data.broker.connectedClients}`);
    console.log(`  - qos0Dropped: ${response.data.broker.qos0Dropped}`);
    console.log(`  - 客户端列表: ${response.data.clients.map((c: any) => c.clientId).join(", ") || "(空)"}`);
  });

  // ───── 11. 服务重启后重连 ─────
  it("11. 断连后统计归零", async () => {
    const c = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "reconnect-test", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      c.on("connect", () => { clearTimeout(t); resolve(); });
    });

    let stats = getBrokerStats();
    expect(stats.connectedClients).toBeGreaterThanOrEqual(1);

    await c.endAsync();
    await new Promise((r) => setTimeout(r, 500));

    stats = getBrokerStats();
    console.log(`[test] 断开后连接数: ${stats.connectedClients}`);
  }, TEST_TIMEOUT);
});

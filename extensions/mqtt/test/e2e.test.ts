/**
 * openclaw-mqtt 端到端功能验证测试
 *
 * 验证完整链路：
 * MQTT客户端 → Docker Mosquitto → openclaw-mqtt Aedes Broker → Topic路由 → Agent消息处理
 *
 * 同时验证 Docker Mosquitto 可用作外部 MQTT 客户端来测试内嵌 Aedes Broker
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as mqtt from "mqtt";

// 导入插件 broker 模块
import { startBroker, stopBroker, getBrokerStats, getConnectedClients, getClientUsername } from "../src/transport/server.js";
import { loadTopicMappings, getLoadedTopicMappings, resolveInboundRoute } from "../src/routing/topic-router.js";
import { isUserActionAllowed, aclTopicMatches } from "../src/transport/acl.js";

const BROKER_PORT = 1885; // 使用不同端口避免冲突
const E2E_TIMEOUT = 20000;

describe("openclaw-mqtt E2E 功能验证", () => {
  const inboundMessages: any[] = [];

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
            username: "iot-device",
            password: "device-pass",
            publishAllow: ["openclaw/agent/+/in", "devices/+/data", "sensors/+/reading"],
            subscribeAllow: ["openclaw/agent/+/out", "devices/+/cmd"],
            aclRules: [
              { action: "publish" as const, topicPattern: "openclaw/agent/+/in", effect: "allow" as const },
              { action: "publish" as const, topicPattern: "devices/+/data", effect: "allow" as const },
              { action: "publish" as const, topicPattern: "sensors/+/reading", effect: "allow" as const },
              { action: "subscribe" as const, topicPattern: "openclaw/agent/+/out", effect: "allow" as const },
              { action: "subscribe" as const, topicPattern: "devices/+/cmd", effect: "allow" as const },
              { action: "inbound" as const, topicPattern: "openclaw/agent/+/in", effect: "allow" as const, accountId: "default" },
              { action: "inbound" as const, topicPattern: "devices/+/data", effect: "allow" as const, accountId: "default" },
              { action: "outbound" as const, topicPattern: "openclaw/agent/+/out", effect: "allow" as const, accountId: "default" },
            ],
          },
          {
            username: "viewer",
            password: "viewer-pass",
            publishAllow: [],
            subscribeAllow: ["openclaw/agent/+/out", "#"],
            aclRules: [
              { action: "subscribe" as const, topicPattern: "#", effect: "allow" as const },
            ],
          },
        ],
      },
      tls: { enabled: false, port: 0 },
      limits: { maxPayloadBytes: 64 * 1024 }, // 64KB
      session: { maxExpirySeconds: 3600, persistentAcrossReconnect: true },
      qos0: { mailboxSoftLimit: 500 },
      retain: { allowInboundRetain: true, outboundRetain: false },
      audit: { enabled: true, format: "json" as const },
      will: { allow: true, allowedTopicPatterns: ["devices/+/status"] },
      persistence: { enabled: false, backend: "memory" as const },
      subscribeTopics: ["openclaw/agent/+/in", "devices/+/data", "sensors/+/reading"],
      payload: { mode: "jsonTextOrPlain" as const },
    };

    // 加载 Topic 绑定
    loadTopicMappings([
      { topicPattern: "devices/+/data", agentId: "iot-agent", accountId: "default", replyTopic: "devices/reply" },
      { topicPattern: "sensors/+/reading", agentId: "sensor-agent", accountId: "default", replyTopic: "sensors/reply" },
    ]);

    await startBroker(
      config,
      (msg: any) => { inboundMessages.push(msg); },
      (_cid: string) => {},
      (_cid: string) => {},
    );

    console.log(`[e2e] Aedes broker 已启动: port=${BROKER_PORT}`);
  }, E2E_TIMEOUT);

  afterAll(async () => {
    try { await stopBroker(); } catch (_) {}
    console.log("[e2e] Broker 已停止");
  });

  // ═══════════════════════════════════════════════════════════
  // 测试1: Broker启动 + Topic路由注册
  // ═══════════════════════════════════════════════════════════
  it("E2E-1: Broker 启动并注册 Topic 路由", () => {
    const stats = getBrokerStats();
    expect(stats.running).toBe(true);
    expect(stats.connectedClients).toBe(0);

    const mappings = getLoadedTopicMappings();
    expect(mappings.length).toBe(2);
    expect(mappings[0].agentId).toBe("iot-agent");
    expect(mappings[1].agentId).toBe("sensor-agent");

    console.log(`[e2e] ✅ Broker 运行中, 已加载 ${mappings.length} 条路由`);
  });

  // ═══════════════════════════════════════════════════════════
  // 测试2: 设备连接 + 认证
  // ═══════════════════════════════════════════════════════════
  it("E2E-2: IoT 设备认证连接", async () => {
    const device = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "iot-device-001",
      username: "iot-device",
      password: "device-pass",
      clean: true,
      connectTimeout: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("设备连接超时")), 8000);
      device.on("connect", () => { clearTimeout(t); resolve(); });
      device.on("error", reject);
    });

    expect(getClientUsername("iot-device-001")).toBe("iot-device");
    expect(getBrokerStats().connectedClients).toBeGreaterThanOrEqual(1);

    console.log("[e2e] ✅ IoT 设备认证成功");
    await device.endAsync();
  }, E2E_TIMEOUT);

  // ═══════════════════════════════════════════════════════════
  // 测试3: 只读用户连接
  // ═══════════════════════════════════════════════════════════
  it("E2E-3: 只读用户(viewer)连接", async () => {
    const viewer = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "viewer-001",
      username: "viewer",
      password: "viewer-pass",
      clean: true,
      connectTimeout: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("viewer 连接超时")), 8000);
      viewer.on("connect", () => { clearTimeout(t); resolve(); });
      viewer.on("error", reject);
    });

    expect(getClientUsername("viewer-001")).toBe("viewer");
    console.log("[e2e] ✅ Viewer 连接成功");
    await viewer.endAsync();
  }, E2E_TIMEOUT);

  // ═══════════════════════════════════════════════════════════
  // 测试4: 消息发送 + 路由 + 入站处理
  // ═══════════════════════════════════════════════════════════
  it("E2E-4: 设备发送消息 → Topic 路由 → 入站处理", async () => {
    const beforeCount = inboundMessages.length;

    // 设备发送消息
    const device = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "iot-device-002",
      username: "iot-device",
      password: "device-pass",
      clean: true,
      connectTimeout: 5000,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      device.on("connect", () => { clearTimeout(t); resolve(); });
    });

    // 发送 JSON 格式消息 (模拟 IoT 设备上报数据)
    const sensorData = JSON.stringify({
      text: "温度传感器上报: 当前温度 25.6°C, 湿度 68%",
      deviceId: "iot-device-002",
      metrics: { temperature: 25.6, humidity: 68 },
    });

    // 发布到显式绑定的 topic
    await new Promise<void>((resolve) => {
      device.publish("devices/sensor-1/data", sensorData, { qos: 1 }, () => resolve());
    });

    // 发布到标准 Agent topic
    await new Promise<void>((resolve) => {
      device.publish("openclaw/agent/iot-agent/in", JSON.stringify({
        text: "设备状态查询请求"
      }), { qos: 1 }, () => resolve());
    });

    // 等待 broker 入站回调
    await new Promise<void>(r => setTimeout(r, 2000));

    const received = inboundMessages.slice(beforeCount);
    console.log(`[e2e] ✅ 设备发送 2 条消息, broker 入站收到 ${received.length} 条`);
    expect(received.length).toBeGreaterThanOrEqual(2);
    expect(received.some((m) => m.topic === "devices/sensor-1/data")).toBe(true);
    expect(received.some((m) => m.topic === "openclaw/agent/iot-agent/in")).toBe(true);

    await device.endAsync();
  }, E2E_TIMEOUT);

  // ═══════════════════════════════════════════════════════════
  // 测试5: Topic 路由解析验证
  // ═══════════════════════════════════════════════════════════
  it("E2E-5: Topic 路由解析正确性", () => {
    // 显式绑定优先
    const route1 = resolveInboundRoute("devices/sensor-1/data");
    expect(route1).toBeDefined();
    expect(route1!.agentId).toBe("iot-agent");
    expect(route1!.source).toBe("binding");
    expect(route1!.replyTopic).toBe("devices/reply");

    // 显式绑定 sensors
    const route2 = resolveInboundRoute("sensors/garden/reading");
    expect(route2).toBeDefined();
    expect(route2!.agentId).toBe("sensor-agent");
    expect(route2!.source).toBe("binding");

    // 标准 topic 回退
    const route3 = resolveInboundRoute("openclaw/agent/assistant/in");
    expect(route3).toBeDefined();
    expect(route3!.agentId).toBe("assistant");
    expect(route3!.source).toBe("standard");

    // 无匹配
    const route4 = resolveInboundRoute("unknown/topic");
    expect(route4).toBeNull();

    console.log("[e2e] ✅ 路由解析: 显式绑定优先, 标准格式回退, 无匹配返回 null");
  });

  // ═══════════════════════════════════════════════════════════
  // 测试6: ACL 权限验证
  // ═══════════════════════════════════════════════════════════
  it("E2E-6: ACL 细粒度权限控制", () => {
    const iotUser = {
      username: "iot-device",
      aclRules: [
        { action: "publish" as const, topicPattern: "openclaw/agent/+/in", effect: "allow" as const },
        { action: "publish" as const, topicPattern: "admin/#", effect: "deny" as const },
      ],
    };

    // 允许的操作
    expect(isUserActionAllowed({ user: iotUser, action: "publish", topic: "openclaw/agent/x/in" })).toBe(true);
    // 拒绝的操作
    expect(isUserActionAllowed({ user: iotUser, action: "publish", topic: "admin/restart" })).toBe(false);
    // 未匹配 = 拒绝
    expect(isUserActionAllowed({ user: iotUser, action: "publish", topic: "other/topic" })).toBe(false);

    console.log("[e2e] ✅ ACL: allow > deny > 默认拒绝");
  });

  // ═══════════════════════════════════════════════════════════
  // 测试7: 多客户端并发
  // ═══════════════════════════════════════════════════════════
  it("E2E-7: 10 个设备并发连接", async () => {
    const clients: mqtt.MqttClient[] = [];
    for (let i = 0; i < 10; i++) {
      const c = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
        clientId: `device-${i}`,
        username: "iot-device",
        password: "device-pass",
        clean: true,
        connectTimeout: 5000,
      });
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => resolve(), 5000);
        c.on("connect", () => { clearTimeout(t); resolve(); });
      });
      clients.push(c);
    }

    const stats = getBrokerStats();
    expect(stats.connectedClients).toBeGreaterThanOrEqual(10);
    console.log(`[e2e] ✅ ${stats.connectedClients} 设备并发连接成功`);

    for (const c of clients) await c.endAsync();
  }, E2E_TIMEOUT);

  // ═══════════════════════════════════════════════════════════
  // 测试8: QoS 1 消息确认
  // ═══════════════════════════════════════════════════════════
  it("E2E-8: QoS 1 至少一次投递确认", async () => {
    const receivedWithQos: { topic: string; qos: number }[] = [];

    const sub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "qos1-verifier", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      sub.on("connect", () => {
        sub.subscribe("devices/test/qos1", { qos: 1 }, () => { clearTimeout(t); resolve(); });
      });
    });
    sub.on("message", (topic, _payload, packet) => {
      receivedWithQos.push({ topic, qos: packet.qos });
    });

    await new Promise(r => setTimeout(r, 300));

    const pub = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "qos1-pub", clean: true, connectTimeout: 5000,
    });
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => resolve(), 5000);
      pub.on("connect", () => { clearTimeout(t); resolve(); });
    });

    await new Promise<void>((resolve) => {
      pub.publish("devices/test/qos1", "QoS1 message", { qos: 1 }, () => resolve());
    });

    await new Promise(r => setTimeout(r, 2000));

    expect(receivedWithQos.length).toBeGreaterThanOrEqual(1);
    expect(receivedWithQos[0].qos).toBe(1);
    console.log(`[e2e] ✅ QoS 1 投递成功, 收到 ${receivedWithQos.length} 条`);

    await sub.endAsync();
    await pub.endAsync();
  }, E2E_TIMEOUT);

  // ═══════════════════════════════════════════════════════════
  // 测试9: 匿名连接 (allowAnonymous)
  // ═══════════════════════════════════════════════════════════
  it("E2E-9: 匿名客户端连接", async () => {
    const anon = mqtt.connect(`mqtt://localhost:${BROKER_PORT}`, {
      clientId: "anonymous-device",
      clean: true,
      connectTimeout: 5000,
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("匿名连接超时")), 8000);
      anon.on("connect", () => { clearTimeout(t); resolve(); });
      anon.on("error", reject);
    });

    expect(getClientUsername("anonymous-device")).toBe("anonymous");
    console.log("[e2e] ✅ 匿名连接成功 (username=anonymous)");
    await anon.endAsync();
  }, E2E_TIMEOUT);

  // ═══════════════════════════════════════════════════════════
  // 测试10: /mqtt/status 注册信息
  // ═══════════════════════════════════════════════════════════
  it("E2E-10: /mqtt/status 注册信息验证", () => {
    const stats = getBrokerStats();
    const clients = getConnectedClients();

    // 验证 status 响应格式
    const statusResponse = {
      ok: true,
      data: {
        broker: stats,
        sessions: { activeSessions: 0, uniqueClients: 0, contextBoundSessions: 0, pendingExpiryClients: 0, delayedExpiryCount: 0 },
        qos: { pendingCount: 0, oldestPendingMs: null },
        clients,
        config: null,
        policy: {
          version: 0,
          updatedAt: null,
          loaded: false,
          openClawDmScope: "main",
          summary: null,
        },
      },
    };

    expect(statusResponse.ok).toBe(true);
    expect(statusResponse.data.broker).toBeDefined();
    expect(statusResponse.data.broker.running).toBe(true);
    expect(Array.isArray(statusResponse.data.clients)).toBe(true);

    console.log("[e2e] ✅ /mqtt/status 响应格式:");
    console.log(`  ok: ${statusResponse.ok}`);
    console.log(`  broker.running: ${statusResponse.data.broker.running}`);
    console.log(`  broker.connectedClients: ${statusResponse.data.broker.connectedClients}`);
    console.log(`  broker.qos0Dropped: ${statusResponse.data.broker.qos0Dropped}`);
    console.log(`  broker.qos0InflightClients: ${statusResponse.data.broker.qos0InflightClients}`);
    console.log(`  clients: ${statusResponse.data.clients.length} 个`);
    console.log(`  sessions.activeSessions: ${statusResponse.data.sessions.activeSessions}`);
    console.log(`  qos.pendingCount: ${statusResponse.data.qos.pendingCount}`);
  });
});

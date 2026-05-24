/**
 * Per-plugin installed OpenClaw E2E assertions (gateway must be running).
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import net from "node:net";
import { E2E_DIR, gatewayFetch, resultRow, STATE_DIR, tcpReachable, waitFor, E2E_PORTS } from "./lib/utils.mjs";

const reqMqtt = createRequire(new URL("../../extensions/mqtt/package.json", import.meta.url));
const reqRabbit = createRequire(new URL("../../extensions/rabbitmq/package.json", import.meta.url));
const reqRocket = createRequire(new URL("../../extensions/rocketmq/package.json", import.meta.url));
const mqtt = reqMqtt("mqtt");
const amqp = reqRabbit("amqplib");
const { Producer } = reqRocket("rocketmq-client-nodejs");

const meta = JSON.parse(readFileSync(`${E2E_DIR}/.e2e-config-meta.json`, "utf8"));
const gotifySecrets = JSON.parse(readFileSync(`${E2E_DIR}/.e2e-secrets.json`, "utf8"));
const installed = JSON.parse(readFileSync(`${STATE_DIR}/.e2e-installed.json`, "utf8"));

/** @type {ReturnType<typeof resultRow>[]} */
export const results = [];

function installedPath(id) {
  return installed.find((p) => p.id === id)?.path ?? "not found";
}

/**
 * @param {string} plugin
 * @param {() => Promise<void>} fn
 * @param {Partial<ReturnType<typeof resultRow>>} meta
 */
async function runTest(plugin, fn, meta = {}) {
  try {
    await fn();
    results.push(resultRow({ plugin, result: "PASS", installedPath: installedPath(plugin), ...meta }));
  } catch (err) {
    results.push(
      resultRow({
        plugin,
        result: "FAIL",
        blocker: err instanceof Error ? err.message : String(err),
        installedPath: installedPath(plugin),
        ...meta,
      }),
    );
  }
}

/** STOMP over raw TCP for stomp-tcp channel */
function stompSend(host, port, destination, body) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      const connect = "CONNECT\naccept-version:1.2\nhost:localhost\n\n\0";
      const send = `SEND\ndestination:${destination}\ncontent-type:application/json\n\n${body}\0`;
      const disconnect = "DISCONNECT\n\n\0";
      socket.write(connect);
      setTimeout(() => {
        socket.write(send);
        setTimeout(() => {
          socket.write(disconnect);
          socket.end();
          resolve(undefined);
        }, 300);
      }, 300);
    });
    socket.setTimeout(8000);
    socket.on("error", reject);
    socket.on("timeout", () => reject(new Error("stomp tcp timeout")));
  });
}

export async function runAllPluginTests() {
  await runTest(
    "mqtt",
    async () => {
      const health = await gatewayFetch("/mqtt/status");
      if (!health.ok) throw new Error(`/mqtt/status → ${health.status}`);
      await waitFor(() => tcpReachable(11883), { label: "mqtt broker 11883", timeoutMs: 30_000 });
      await new Promise((resolve, reject) => {
        const client = mqtt.connect("mqtt://127.0.0.1:11883", { clientId: `e2e-${Date.now()}`, reconnectPeriod: 0 });
        client.on("connect", () => {
          client.publish("openclaw/agent/main/in", JSON.stringify({ text: "e2e mqtt ping" }), {}, (err) => {
            client.end(true);
            if (err) reject(err);
            else resolve(undefined);
          });
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("mqtt publish timeout")), 10_000);
      });
    },
    { service: "embedded:11883", method: "GET /mqtt/status + mqtt publish" },
  );

  await runTest(
    "rabbitmq",
    async () => {
      const health = await gatewayFetch("/rabbitmq/health");
      const connected = health.json?.data?.connected === true;
      if (!connected) {
        throw new Error(`/rabbitmq/health → ${health.status}: ${health.text}`);
      }
      const conn = await amqp.connect("amqp://127.0.0.1:5672");
      const ch = await conn.createChannel();
      await ch.assertExchange("openclaw-e2e", "topic", { durable: true });
      ch.publish("openclaw-e2e", "openclaw.agent.main.in", Buffer.from(JSON.stringify({ text: "e2e rabbit ping" })));
      await ch.close();
      await conn.close();
      await waitFor(async () => {
        const stats = await gatewayFetch("/rabbitmq/stats");
        const received = stats.json?.data?.stats?.messagesReceived;
        return stats.ok && typeof received === "number" && received > 0;
      }, { label: "rabbitmq stats messagesReceived", timeoutMs: 15_000 });
    },
    { service: "docker:5672", method: "amqp publish + /rabbitmq/health" },
  );

  await runTest(
    "rocketmq",
    async () => {
      const health = await gatewayFetch("/rocketmq/health");
      const connected = health.json?.data?.connected === true;
      if (!connected) {
        throw new Error(`/rocketmq/health → ${health.status}: ${health.text}`);
      }
      const up = await tcpReachable(8081);
      if (!up) throw new Error("RocketMQ proxy 8081 not reachable");
      const producer = new Producer({ endpoints: "127.0.0.1:8081", namespace: "", requestTimeout: 10_000 });
      try {
        await producer.startup();
        await producer.send({
          topic: meta.rocketmqTopic,
          tag: "*",
          body: Buffer.from(JSON.stringify({ text: "e2e rocketmq ping" })),
        });
      } finally {
        producer.shutdown().catch(() => {});
      }
    },
    { service: "docker:8081", method: "Producer.send + /rocketmq/health" },
  );

  await runTest(
    "gotify",
    async () => {
      const status = await gatewayFetch("/gotify/status");
      if (!status.ok) throw new Error(`/gotify/status → ${status.status}`);
      const res = await fetch(`${gotifySecrets.serverUrl}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gotify-Key": gotifySecrets.appToken },
        body: JSON.stringify({ title: "e2e", message: "gotify inbound ping", priority: 5 }),
      });
      if (!res.ok) throw new Error(`gotify POST /message → ${res.status}`);
      await waitFor(async () => {
        const h = await gatewayFetch("/gotify/health");
        return h.ok;
      }, { label: "gotify health", timeoutMs: 20_000 });
    },
    { service: "docker:18080", method: "POST /message + /gotify/status" },
  );

  await runTest(
    "stomp",
    async () => {
      const status = await gatewayFetch("/stomp-tcp/status");
      if (!status.ok) throw new Error(`/stomp-tcp/status → ${status.status}`);
      await waitFor(() => tcpReachable(E2E_PORTS.stompTcp), { label: `stomp-tcp ${E2E_PORTS.stompTcp}`, timeoutMs: 30_000 });
      await stompSend("127.0.0.1", E2E_PORTS.stompTcp, "/queue/agent.main.in", JSON.stringify({ text: "e2e stomp ping" }));
    },
    { service: `embedded:${E2E_PORTS.stompTcp}`, method: "STOMP SEND + /stomp-tcp/status" },
  );

  await runTest(
    "web-mqtt",
    async () => {
      const status = await gatewayFetch("/mqtt-ws/status");
      if (!status.ok) throw new Error(`/mqtt-ws/status → ${status.status}`);
      await waitFor(() => tcpReachable(E2E_PORTS.webMqttWs), { label: `web-mqtt ws ${E2E_PORTS.webMqttWs}`, timeoutMs: 30_000 });
      await new Promise((resolve, reject) => {
        const client = mqtt.connect(`ws://127.0.0.1:${E2E_PORTS.webMqttWs}/ws`, {
          clientId: `e2e-ws-${Date.now()}`,
          reconnectPeriod: 0,
        });
        client.on("connect", () => {
          client.publish("openclaw/agent/main/in", JSON.stringify({ text: "e2e web-mqtt ping" }), {}, (err) => {
            client.end(true);
            if (err) reject(err);
            else resolve(undefined);
          });
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("web-mqtt timeout")), 12_000);
      });
    },
    { service: `embedded:${E2E_PORTS.webMqttWs}/ws`, method: "WS mqtt publish + /mqtt-ws/status" },
  );

  await runTest(
    "web-stomp",
    async () => {
      const status = await gatewayFetch("/stomp/status");
      if (!status.ok) throw new Error(`/stomp/status → ${status.status}`);
      await waitFor(() => tcpReachable(E2E_PORTS.webStompWs), { label: `web-stomp ws ${E2E_PORTS.webStompWs}`, timeoutMs: 30_000 });
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${E2E_PORTS.webStompWs}/ws`);
        ws.onopen = () => {
          ws.send("CONNECT\naccept-version:1.2\nhost:localhost\n\n\0");
          setTimeout(() => {
            ws.send(
              `SEND\ndestination:/queue/agent.demo\ncontent-type:application/json\n\n${JSON.stringify({ text: "e2e web-stomp ping" })}\0`,
            );
            setTimeout(() => {
              ws.close();
              resolve(undefined);
            }, 500);
          }, 400);
        };
        ws.onerror = () => reject(new Error("web-stomp websocket error"));
        setTimeout(() => reject(new Error("web-stomp timeout")), 12_000);
      });
    },
    { service: `embedded:${E2E_PORTS.webStompWs}/ws`, method: "WS STOMP SEND + /stomp/status" },
  );
}

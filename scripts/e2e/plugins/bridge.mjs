/** Bridge tarball + MQTT：验证真实 Hook 事件被后台镜像到审计 Topic，并且不会自回环。 */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url));
const mqtt = req("mqtt");

function waitForTopics(client, topics, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const messages = new Map();
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Bridge topics: ${[...topics].filter((topic) => !messages.has(topic)).join(", ")}`));
    }, timeoutMs);
    timer.unref?.();
    const onMessage = (topic, payload) => {
      if (!topics.has(topic)) return;
      messages.set(topic, payload.toString("utf8"));
      if (messages.size === topics.size) {
        cleanup();
        resolve(messages);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      client.off("message", onMessage);
      client.off("error", onError);
    };
    client.on("message", onMessage);
    client.on("error", onError);
  });
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testBridge(ctx, results) {
  await runAdapterTest(
    ctx,
    "bridge",
    async () => {
      if (!ctx.pluginIds.includes("mqtt")) throw new Error("Bridge E2E requires --plugins bridge,mqtt");
      if (!ctx.modelFixture) throw new Error("Bridge E2E requires the local model fixture");
      await ctx.waitFor(() => ctx.tcpReachable(11883), { label: "MQTT bridge target", timeoutMs: 30_000 });

      const inboundTopic = "openclaw/agent/main/in";
      const replyTopic = "openclaw/agent/main/out";
      const mirrorInbound = "openclaw/bridge/mqtt/inbound";
      const mirrorOutbound = "openclaw/bridge/mqtt/outbound";
      const expected = new Set([replyTopic, mirrorInbound, mirrorOutbound]);
      const client = mqtt.connect("mqtt://127.0.0.1:11883", {
        clientId: `bridge-e2e-${Date.now()}`,
        reconnectPeriod: 0,
        connectTimeout: 15_000,
        clean: true,
      });
      const auditCounts = new Map([[mirrorInbound, 0], [mirrorOutbound, 0]]);
      const countAuditMessage = (topic) => {
        if (auditCounts.has(topic)) auditCounts.set(topic, auditCounts.get(topic) + 1);
      };
      client.on("message", countAuditMessage);
      try {
        await new Promise((resolve, reject) => {
          client.once("connect", resolve);
          client.once("error", reject);
        });
        const granted = await client.subscribeAsync([...expected], { qos: 1 });
        if (granted.some((entry) => entry.qos !== 1)) {
          throw new Error(`Bridge MQTT subscription QoS mismatch: ${JSON.stringify(granted)}`);
        }
        const beforeCompletions = ctx.modelFixture.metrics.completions;
        const observed = waitForTopics(client, expected);
        await client.publishAsync(inboundTopic, JSON.stringify({
          ...ctx.pingPayload,
          text: "Return the Bridge E2E fixture response.",
          idempotencyKey: `bridge-turn-${Date.now()}`,
        }), { qos: 1, retain: false });
        const messages = await observed;
        const inbound = JSON.parse(messages.get(mirrorInbound));
        const outbound = JSON.parse(messages.get(mirrorOutbound));
        if (inbound.direction !== "inbound" || inbound.source?.channel !== "mqtt" || !inbound.messageId?.startsWith("bridge/in/mqtt/")) {
          throw new Error(`Invalid Bridge inbound mirror: ${messages.get(mirrorInbound)}`);
        }
        if (outbound.direction !== "outbound" || outbound.text !== "openclaw e2e fixture reply" || !outbound.messageId?.startsWith("bridge/out/mqtt/")) {
          throw new Error(`Invalid Bridge outbound mirror: ${messages.get(mirrorOutbound)}`);
        }
        if (ctx.modelFixture.metrics.completions - beforeCompletions !== 1) {
          throw new Error("Bridge source Agent Turn did not call the model exactly once");
        }
        // 审计消息本身也经 MQTT 出站；短暂观察后主题计数仍应各为 1，证明自回环闸门有效。
        await new Promise((resolve) => setTimeout(resolve, 250));
        if ([...auditCounts.values()].some((count) => count !== 1)) {
          throw new Error(`Bridge audit topic recursion detected: ${JSON.stringify(Object.fromEntries(auditCounts))}`);
        }
      } finally {
        client.off("message", countAuditMessage);
        client.end(true);
      }
    },
    {
      service: "Bridge + embedded MQTT:11883 + model fixture",
      method: "tarball hooks → bounded background delivery → inbound/outbound MQTT audit topics",
    },
    results,
  );
}

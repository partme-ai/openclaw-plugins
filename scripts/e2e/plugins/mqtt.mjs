/**
 * MQTT 内嵌 Broker 真实 Agent 回路 E2E 适配器。
 *
 * 验证范围不是“端口可连 + Publish 写入成功”，而是完整覆盖：订阅回复 Topic、
 * MQTT QoS 1 入站、OpenClaw Agent 完成一次模型调用、标准 envelope 出站。
 */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url));
const mqtt = req("mqtt");

/** 等待指定 Topic 的单条回复，并在超时或客户端错误时完成清理。 */
function waitForMessage(client, expectedTopic, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for MQTT reply on ${expectedTopic}`));
    }, timeoutMs);
    timer.unref?.();
    const onMessage = (topic, payload, packet) => {
      if (topic !== expectedTopic) return;
      cleanup();
      resolve({ topic, payload: payload.toString("utf8"), packet });
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

/** @param {import('./_context.mjs').createTestContext extends (...args: never) => infer R ? R : never} ctx */
/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testMqtt(ctx, results) {
  await runAdapterTest(
    ctx,
    "mqtt",
    async () => {
      const health = await ctx.gatewayFetch("/mqtt/status");
      if (!health.ok) throw new Error(`/mqtt/status → ${health.status}`);
      await ctx.waitFor(() => ctx.tcpReachable(11883), { label: "mqtt broker 11883", timeoutMs: 30_000 });
      // The tracing adapter already performs a request/reply Agent Turn over
      // this broker. Avoid sending a second turn after its controlled model
      // fixture has shut down.
      if (ctx.pluginIds.includes("tracing")) return;
      if (!ctx.modelFixture) throw new Error("MQTT Agent E2E requires the local model fixture");

      const inboundTopic = "openclaw/agent/main/in";
      const replyTopic = "openclaw/agent/main/out";
      const client = mqtt.connect("mqtt://127.0.0.1:11883", {
        clientId: `mqtt-e2e-${Date.now()}`,
        reconnectPeriod: 0,
        connectTimeout: 15_000,
        clean: true,
      });
      try {
        await new Promise((resolve, reject) => {
          client.once("connect", resolve);
          client.once("error", reject);
        });
        const granted = await client.subscribeAsync(replyTopic, { qos: 1 });
        if (granted[0]?.qos !== 1) throw new Error(`MQTT reply subscription QoS mismatch: ${JSON.stringify(granted)}`);

        const beforeCompletions = ctx.modelFixture.metrics.completions;
        const replyPromise = waitForMessage(client, replyTopic);
        await client.publishAsync(
          inboundTopic,
          JSON.stringify({
            ...ctx.pingPayload,
            text: "Return the MQTT E2E fixture response.",
            idempotencyKey: `mqtt-turn-${Date.now()}`,
          }),
          { qos: 1, retain: false },
        );
        const reply = await replyPromise;
        const envelope = JSON.parse(reply.payload);
        if (envelope?.message?.text !== "openclaw e2e fixture reply") {
          throw new Error(`Unexpected MQTT reply envelope: ${reply.payload}`);
        }
        if (envelope?.message?.source?.channel !== "mqtt") {
          throw new Error(`MQTT reply source channel missing: ${reply.payload}`);
        }
        if (envelope?.headers?.replyRoute?.topic !== replyTopic) {
          throw new Error(`MQTT reply route missing: ${reply.payload}`);
        }
        const completionDelta = ctx.modelFixture.metrics.completions - beforeCompletions;
        if (completionDelta !== 1) {
          throw new Error(`MQTT model completion count mismatch: expected 1, got ${completionDelta}`);
        }
      } finally {
        client.end(true);
      }
    },
    {
      service: "embedded:11883",
      method: "MQTT QoS 1 publish → real Agent Turn → subscribed reply",
    },
    results,
  );
}

/** Web MQTT embedded gateway real Agent E2E adapter. */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url));
const mqtt = req("mqtt");

function waitForMessage(client, expectedTopic, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Web-MQTT reply on ${expectedTopic}`));
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

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testWebMqtt(ctx, results) {
  await runAdapterTest(
    ctx,
    "web-mqtt",
    async () => {
      if (!ctx.modelFixture) throw new Error("Web-MQTT Agent E2E requires the local model fixture");
      const status = await ctx.gatewayFetch("/mqtt-ws/status");
      if (!status.ok) throw new Error(`/mqtt-ws/status → ${status.status}`);
      const port = ctx.ports.webMqttWs;
      await ctx.waitFor(() => ctx.tcpReachable(port), { label: `web-mqtt ws ${port}`, timeoutMs: 30_000 });

      const clientId = `web-mqtt-e2e-${Date.now()}`;
      const inboundTopic = "openclaw/agent/main/in";
      const replyTopic = "openclaw/agent/main/out";
      const client = mqtt.connect(`ws://127.0.0.1:${port}/ws`, {
        clientId,
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
        if (granted[0]?.qos !== 1) throw new Error(`Web-MQTT reply subscription QoS mismatch: ${JSON.stringify(granted)}`);

        const beforeCompletions = ctx.modelFixture.metrics.completions;
        const idempotencyKey = `web-mqtt-turn-${Date.now()}`;
        const replyPromise = waitForMessage(client, replyTopic);
        await client.publishAsync(
          inboundTopic,
          JSON.stringify({
            ...ctx.pingPayload,
            text: "Return the Web-MQTT E2E fixture response.",
            idempotencyKey,
          }),
          { qos: 1, retain: false },
        );
        const reply = await replyPromise;
        const envelope = JSON.parse(reply.payload);
        if (envelope?.message?.text !== "openclaw e2e fixture reply") {
          throw new Error(`Unexpected Web-MQTT reply envelope: ${reply.payload}`);
        }
        if (envelope?.message?.source?.channel !== "mqtt-ws") {
          throw new Error(`Web-MQTT reply source channel missing: ${reply.payload}`);
        }
        if (envelope?.headers?.replyRoute?.topic !== replyTopic) {
          throw new Error(`Web-MQTT reply route missing: ${reply.payload}`);
        }

        const completionDelta = ctx.modelFixture.metrics.completions - beforeCompletions;
        if (completionDelta !== 1) {
          throw new Error(`Web-MQTT model completion count mismatch: expected 1, got ${completionDelta}`);
        }
        const finalStatus = await ctx.gatewayFetch("/mqtt-ws/status");
        const snapshot = finalStatus.json?.data?.stats ?? finalStatus.json?.data?.snapshot ?? finalStatus.json?.data;
        if (!finalStatus.ok || Number(snapshot?.acceptedMessages ?? 0) < 1 || Number(snapshot?.outboundMessages ?? 0) < 1) {
          throw new Error(`Web-MQTT transport statistics missing: ${finalStatus.text}`);
        }
      } finally {
        client.end(true);
      }
    },
    {
      service: `embedded:${ctx.ports.webMqttWs}/ws`,
      method: "WS MQTT QoS 1 publish → real Agent Turn → subscribed reply",
    },
    results,
  );
}

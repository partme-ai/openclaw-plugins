/**
 * MQTT embedded broker E2E adapter.
 */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url));
const mqtt = req("mqtt");

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
      const body = JSON.stringify({ ...ctx.pingPayload, text: "e2e mqtt ping" });
      await new Promise((resolve, reject) => {
        const client = mqtt.connect("mqtt://127.0.0.1:11883", {
          clientId: `e2e-${Date.now()}`,
          reconnectPeriod: 0,
        });
        client.on("connect", () => {
          client.publish("openclaw/agent/main/in", body, {}, (err) => {
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
    results,
  );
}

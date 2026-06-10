/**
 * Web MQTT (WS) embedded gateway E2E adapter.
 */
import { createRequire } from "node:module";
import { runAdapterTest } from "./_context.mjs";

const req = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url));
const mqtt = req("mqtt");

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testWebMqtt(ctx, results) {
  await runAdapterTest(
    ctx,
    "web-mqtt",
    async () => {
      const status = await ctx.gatewayFetch("/mqtt-ws/status");
      if (!status.ok) throw new Error(`/mqtt-ws/status → ${status.status}`);
      const port = ctx.ports.webMqttWs;
      await ctx.waitFor(() => ctx.tcpReachable(port), { label: `web-mqtt ws ${port}`, timeoutMs: 30_000 });
      await new Promise((resolve, reject) => {
        const client = mqtt.connect(`ws://127.0.0.1:${port}/ws`, {
          clientId: `e2e-ws-${Date.now()}`,
          reconnectPeriod: 0,
        });
        client.on("connect", () => {
          client.publish(
            "openclaw/agent/main/in",
            JSON.stringify({ ...ctx.pingPayload, text: "e2e web-mqtt ping" }),
            {},
            (err) => {
              client.end(true);
              if (err) reject(err);
              else resolve(undefined);
            },
          );
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("web-mqtt timeout")), 12_000);
      });
    },
    { service: `embedded:${ctx.ports.webMqttWs}/ws`, method: "WS mqtt publish + /mqtt-ws/status" },
    results,
  );
}

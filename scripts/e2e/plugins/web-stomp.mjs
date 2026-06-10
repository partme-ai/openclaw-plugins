/**
 * Web STOMP (WS) embedded gateway E2E adapter.
 */
import { runAdapterTest } from "./_context.mjs";

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testWebStomp(ctx, results) {
  await runAdapterTest(
    ctx,
    "web-stomp",
    async () => {
      const status = await ctx.gatewayFetch("/stomp/status");
      if (!status.ok) throw new Error(`/stomp/status → ${status.status}`);
      const port = ctx.ports.webStompWs;
      await ctx.waitFor(() => ctx.tcpReachable(port), { label: `web-stomp ws ${port}`, timeoutMs: 30_000 });
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
        ws.onopen = () => {
          ws.send("CONNECT\naccept-version:1.2\nhost:localhost\n\n\0");
          setTimeout(() => {
            ws.send(
              `SEND\ndestination:/queue/agent.demo\ncontent-type:application/json\n\n${JSON.stringify({ ...ctx.pingPayload, text: "e2e web-stomp ping" })}\0`,
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
    { service: `embedded:${ctx.ports.webStompWs}/ws`, method: "WS STOMP SEND + /stomp/status" },
    results,
  );
}

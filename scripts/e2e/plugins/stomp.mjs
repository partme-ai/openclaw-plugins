/**
 * STOMP TCP embedded broker E2E adapter.
 */
import net from "node:net";
import { runAdapterTest } from "./_context.mjs";

/**
 * @param {string} host
 * @param {number} port
 * @param {string} destination
 * @param {string} body
 */
function stompSend(host, port, destination, body) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.write("CONNECT\naccept-version:1.2\nhost:localhost\n\n\0");
      setTimeout(() => {
        socket.write(`SEND\ndestination:${destination}\ncontent-type:application/json\n\n${body}\0`);
        setTimeout(() => {
          socket.write("DISCONNECT\n\n\0");
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

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testStomp(ctx, results) {
  await runAdapterTest(
    ctx,
    "stomp",
    async () => {
      const status = await ctx.gatewayFetch("/stomp-tcp/status");
      if (!status.ok) throw new Error(`/stomp-tcp/status → ${status.status}`);
      await ctx.waitFor(() => ctx.tcpReachable(ctx.ports.stompTcp), {
        label: `stomp-tcp ${ctx.ports.stompTcp}`,
        timeoutMs: 30_000,
      });
      await stompSend(
        "127.0.0.1",
        ctx.ports.stompTcp,
        "/queue/agent.main.in",
        JSON.stringify({ ...ctx.pingPayload, text: "e2e stomp ping" }),
      );
    },
    { service: `embedded:${ctx.ports.stompTcp}`, method: "STOMP SEND + /stomp-tcp/status" },
    results,
  );
}

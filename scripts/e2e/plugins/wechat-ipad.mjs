/** 微信 iPad tarball → WS 入站 → Agent → HTTP 回复 → Gateway 重启防重闭环。 */
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { runAdapterTest } from "./_context.mjs";

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testWechatIpad(ctx, results) {
  await runAdapterTest(
    ctx,
    "wechat-ipad",
    async () => {
      const model = ctx.modelFixture;
      const provider = ctx.wechatIpadProvider;
      if (!model || !provider) throw new Error("WeChat iPad E2E requires model and bridge fixtures");

      await ctx.waitFor(() => Promise.resolve(provider.metrics.replies === 1), {
        timeoutMs: 60_000,
        intervalMs: 100,
        label: "WeChat iPad Agent reply",
      });
      const reply = provider.metrics.lastReply;
      if (
        model.metrics.completions !== 1 ||
        reply?.authorization !== "Bearer wechat-ipad-e2e-token" ||
        reply?.body?.toWxid !== "wxid_e2e_user" ||
        reply?.body?.msgType !== "text" ||
        reply?.body?.content !== "openclaw e2e fixture reply"
      ) {
        throw new Error("WeChat iPad Agent turn, Bearer token, recipient, or reply text mismatch");
      }

      // 新连接再次推送相同 msgId，持久日志必须在 Gateway 重启后仍阻止第二次 Agent Turn。
      provider.replayMessage();
      await ensureGatewayRunning();
      await ctx.waitFor(() => Promise.resolve(provider.metrics.deliveredEvents === 2), {
        timeoutMs: 30_000,
        intervalMs: 100,
        label: "WeChat iPad duplicate replay after restart",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (model.metrics.completions !== 1 || provider.metrics.replies !== 1) {
        throw new Error("WeChat iPad post-restart duplicate bypassed persistent message dedupe");
      }
    },
    {
      service: "local WebSocket + HTTP external bridge fixture and model fixture",
      method: "tarball install + WS receive + Agent Turn + HTTP reply + Gateway restart dedupe",
    },
    results,
  );
}

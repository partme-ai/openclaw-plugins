/** 微信 iLink tarball → 长轮询 → Agent → sendMessage → 重启防重闭环。 */
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { runAdapterTest } from "./_context.mjs";

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testWechat(ctx, results) {
  await runAdapterTest(
    ctx,
    "wechat",
    async () => {
      const model = ctx.modelFixture;
      const provider = ctx.wechatProvider;
      if (!model || !provider) throw new Error("WeChat E2E requires model and iLink fixtures");

      await ctx.waitFor(() => Promise.resolve(provider.metrics.replies >= 1), {
        timeoutMs: 60_000,
        intervalMs: 100,
        label: "WeChat Agent reply",
      });
      const beforeReplayCompletions = model.metrics.completions;
      const beforeReplayReplies = provider.metrics.replies;
      const beforeReplayDeliveries = provider.metrics.deliveredBatches;
      const reply = provider.metrics.lastReply;
      const message = reply?.body?.msg;
      const text = message?.item_list?.[0]?.text_item?.text;
      if (
        reply?.authorization !== "Bearer wechat-e2e-token" ||
        message?.to_user_id !== "wechat-e2e-user@im.wechat" ||
        message?.context_token !== "wechat-e2e-context-token" ||
        text !== "openclaw e2e fixture reply"
      ) {
        throw new Error("WeChat sendMessage token, recipient, context token, or reply text mismatch");
      }

      // 让平台在 Gateway 重启后重放同一个 message_id；持久去重必须 ACK 游标但不再调用模型/发送。
      provider.replayMessage();
      await ensureGatewayRunning();
      await ctx.waitFor(() => Promise.resolve(provider.metrics.deliveredBatches === beforeReplayDeliveries + 1), {
        timeoutMs: 30_000,
        intervalMs: 100,
        label: "WeChat duplicate replay after restart",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (model.metrics.completions !== beforeReplayCompletions || provider.metrics.replies !== beforeReplayReplies) {
        throw new Error("WeChat post-restart duplicate bypassed persistent message dedupe");
      }
    },
    {
      service: "local WeChat iLink long-poll fixture + OpenAI-compatible model fixture",
      method: "tarball install + getUpdates + Agent Turn + context-token reply + Gateway restart dedupe",
    },
    results,
  );
}

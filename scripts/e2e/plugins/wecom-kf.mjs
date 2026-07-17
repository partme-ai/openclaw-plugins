/** 企业微信客服 tarball → 加密回调 → sync_msg → Agent → send_msg → 重启防重闭环。 */
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { GATEWAY_HTTP } from "../lib/utils.mjs";
import { WECOM_KF_E2E } from "../helpers/wecom-kf-provider.mjs";
import { runAdapterTest } from "./_context.mjs";

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testWecomKf(ctx, results) {
  await runAdapterTest(
    ctx,
    "wecom-kf",
    async () => {
      const model = ctx.modelFixture;
      const provider = ctx.wecomKfProvider;
      if (!model || !provider) throw new Error("WeCom KF E2E requires model and OpenAPI fixtures");

      await provider.triggerCallback(GATEWAY_HTTP);
      await ctx.waitFor(() => Promise.resolve(provider.metrics.replies === 1), {
        timeoutMs: 60_000,
        intervalMs: 100,
        label: "WeCom KF Agent reply",
      });
      const reply = provider.metrics.lastReply;
      if (
        model.metrics.completions !== 1 ||
        reply?.touser !== WECOM_KF_E2E.externalUserId ||
        reply?.open_kfid !== WECOM_KF_E2E.openKfId ||
        reply?.msgtype !== "text" ||
        reply?.text?.content !== "openclaw e2e fixture reply"
      ) {
        throw new Error("WeCom KF Agent turn, recipient, account, or reply text mismatch");
      }
      if (provider.metrics.syncRequests[0]?.token !== "wecom-kf-e2e-sync-token") {
        throw new Error("WeCom KF first sync_msg did not use callback token");
      }

      // Gateway 重启后再次回放相同 msgid：游标应恢复，且持久化 claim/commit 必须阻止二次回复。
      await ensureGatewayRunning();
      await provider.triggerCallback(GATEWAY_HTTP);
      await ctx.waitFor(() => Promise.resolve(provider.metrics.syncRequests.length === 2), {
        timeoutMs: 30_000,
        intervalMs: 100,
        label: "WeCom KF sync after Gateway restart",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (provider.metrics.syncRequests[1]?.cursor !== "wecom-kf-e2e-cursor-1") {
        throw new Error("WeCom KF cursor was not restored after Gateway restart");
      }
      if (model.metrics.completions !== 1 || provider.metrics.replies !== 1) {
        throw new Error("WeCom KF post-restart duplicate bypassed persistent msgid dedupe");
      }
    },
    {
      service: "local encrypted callback + WeCom OpenAPI fixture and model fixture",
      method: "tarball install + encrypted callback + sync_msg + Agent Turn + send_msg + restart dedupe",
    },
    results,
  );
}

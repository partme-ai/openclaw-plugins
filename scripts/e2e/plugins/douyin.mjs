/**
 * 抖音 Webhook 的跨进程安装态 E2E。
 *
 * 覆盖链路：tarball 安装 → Gateway 动态路由 → 挑战应答/验签 → 真实 Agent Turn →
 * 持久 Inbox 故障留存/重启恢复 → `Msg-Id` 并发防重与持久防重。测试不伪造抖音 OpenAPI 写操作。
 */
import { createHash } from "node:crypto";

import { DOUYIN_E2E_CONFIG } from "../config/plugins/douyin.mjs";
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { runAdapterTest } from "./_context.mjs";

const WEBHOOK_PATH = DOUYIN_E2E_CONFIG.webhook_path;

/** 与生产插件一致，签名必须基于未经 JSON 重序列化的原始字节文本。 */
function sign(body) {
  return createHash("sha1")
    .update(DOUYIN_E2E_CONFIG.app_secret + body, "utf8")
    .digest("hex");
}

async function postWebhook(ctx, body, headers = {}) {
  return ctx.gatewayFetch(WEBHOOK_PATH, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function waitForCompletions(ctx, expected, label) {
  await ctx.waitFor(
    () => Promise.resolve(ctx.modelFixture.metrics.completions === expected),
    { timeoutMs: 60_000, intervalMs: 100, label },
  );
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testDouyin(ctx, results) {
  await runAdapterTest(
    ctx,
    "douyin",
    async () => {
      if (!ctx.modelFixture) throw new Error("Douyin E2E requires the local OpenAI model fixture");

      const challengeBody = JSON.stringify({
        event: "verify_webhook",
        client_key: DOUYIN_E2E_CONFIG.app_key,
        content: { challenge: 24680 },
      });
      const challenge = await postWebhook(ctx, challengeBody, {
        "x-douyin-signature": sign(challengeBody),
      });
      if (challenge.status !== 200 || challenge.json?.challenge !== 24680) {
        throw new Error(`signed verify_webhook failed: HTTP ${challenge.status} ${challenge.text}`);
      }

      const invalid = await postWebhook(ctx, '{"event":"message"}', {
        "x-douyin-signature": "0".repeat(40),
        "msg-id": "douyin-e2e-invalid",
      });
      if (invalid.status !== 401) {
        throw new Error(`invalid signature was not rejected: HTTP ${invalid.status}`);
      }

      const messageId = `douyin-e2e-${Date.now()}`;
      const eventBody = JSON.stringify({
        event: "life_service.message",
        client_key: DOUYIN_E2E_CONFIG.app_key,
        content: {
          from_user_id: "douyin-e2e-user",
          text: "请处理抖音 E2E 入站消息",
        },
      });
      const headers = {
        "x-douyin-signature": sign(eventBody),
        "msg-id": messageId,
      };
      const completionsBefore = ctx.modelFixture.metrics.completions;
      const accepted = await postWebhook(ctx, eventBody, headers);
      if (accepted.status !== 200 || accepted.text !== "success") {
        throw new Error(`valid webhook was not acknowledged: HTTP ${accepted.status} ${accepted.text}`);
      }
      await waitForCompletions(ctx, completionsBefore + 1, "Douyin Agent Turn completion");

      // 同一进程内重放不得再次触发模型；HTTP 仍返回 success，避免平台持续重试。
      const duplicate = await postWebhook(ctx, eventBody, headers);
      if (duplicate.status !== 200) throw new Error(`duplicate webhook ACK failed: ${duplicate.status}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (ctx.modelFixture.metrics.completions !== completionsBefore + 1) {
        throw new Error("duplicate Msg-Id triggered a second Agent Turn");
      }

      // 重启 Gateway 后再次重放，证明防重来自状态目录中的持久层，而非进程内 Map。
      await ensureGatewayRunning();
      const postRestartDuplicate = await postWebhook(ctx, eventBody, headers);
      if (postRestartDuplicate.status !== 200) {
        throw new Error(`post-restart duplicate ACK failed: ${postRestartDuplicate.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (ctx.modelFixture.metrics.completions !== completionsBefore + 1) {
        throw new Error("post-restart duplicate Msg-Id bypassed persistent deduplication");
      }

      // 注入模型失败，验证 Webhook 仍在持久提交后快速 ACK，并且失败任务留在 Inbox 而非丢失。
      const recoveryId = `douyin-e2e-recovery-${Date.now()}`;
      const recoveryBody = JSON.stringify({
        event: "life_service.message",
        client_key: DOUYIN_E2E_CONFIG.app_key,
        content: { from_user_id: "douyin-e2e-recovery-user", text: "验证持久 Inbox 重启恢复" },
      });
      ctx.modelFixture.controls.failNextCompletions = 10;
      const recoveryAccepted = await postWebhook(ctx, recoveryBody, {
        "x-douyin-signature": sign(recoveryBody),
        "msg-id": recoveryId,
      });
      if (recoveryAccepted.status !== 200) {
        throw new Error(`recovery webhook was not durably acknowledged: ${recoveryAccepted.status}`);
      }
      await ctx.waitFor(async () => {
        const status = await ctx.gatewayFetch("/douyin/status");
        return status.status === 200 && status.json?.inboxes?.default?.pending === 1;
      }, { timeoutMs: 30_000, intervalMs: 100, label: "Douyin durable Inbox pending state" });

      // 清除故障并重启 Gateway；新进程必须从 stateDir 恢复 pending 事件并完成一次 Agent Turn。
      ctx.modelFixture.controls.failNextCompletions = 0;
      const beforeRecovery = ctx.modelFixture.metrics.completions;
      await ensureGatewayRunning();
      await waitForCompletions(ctx, beforeRecovery + 1, "Douyin Inbox restart recovery");
      await ctx.waitFor(async () => {
        const status = await ctx.gatewayFetch("/douyin/status");
        return status.status === 200 && status.json?.inboxes?.default?.pending === 0;
      }, { timeoutMs: 30_000, intervalMs: 100, label: "Douyin durable Inbox drained state" });
    },
    {
      service: "local signed Douyin Webhook + OpenAI-compatible model fixture",
      method: "tarball install + signed Webhook + durable Inbox restart recovery + persistent dedupe",
    },
    results,
  );
}

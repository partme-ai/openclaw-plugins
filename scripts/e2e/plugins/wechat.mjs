/** 微信 iLink tarball → 长轮询 → Agent → sendMessage → 重启防重闭环。 */
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { STATE_DIR } from "../lib/utils.mjs";
import { runAdapterTest } from "./_context.mjs";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The WeChat processed-message journal is written only after processOneMessage returns. */
export async function waitForWechatMessageSettlement(waitFor, modelMetrics, beforeCompletions, messageId, journalPath) {
  await waitFor(() => {
    if (modelMetrics.completionsFinished <= beforeCompletions || !existsSync(journalPath)) {
      return Promise.resolve(false);
    }
    const processed = readFileSync(journalPath, "utf8").split("\n").some((line) => {
      if (!line) return false;
      try { return JSON.parse(line).id === messageId; }
      catch { return false; }
    });
    return Promise.resolve(processed);
  }, {
    timeoutMs: 60_000,
    intervalMs: 100,
    label: `WeChat Agent dispatch settled for ${messageId}`,
  });
}

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

      const allowedRoot = join(STATE_DIR, "workspace", "wechat-media", "allowed");
      const siblingRoot = join(STATE_DIR, "wechat-media", "sibling");
      mkdirSync(allowedRoot, { recursive: true });
      mkdirSync(siblingRoot, { recursive: true });
      const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6D1cAAAAASUVORK5CYII=", "base64");
      const allowedFile = join(allowedRoot, "result.png");
      const escapedFile = join(siblingRoot, "secret.png");
      writeFileSync(allowedFile, imageBytes);
      writeFileSync(escapedFile, imageBytes);

      model.controls.replyText = `MEDIA:${allowedFile}`;
      provider.enqueueMessage("wechat-e2e-media-allowed", "请回复允许目录内的媒体");
      await ctx.waitFor(() => Promise.resolve(provider.metrics.uploads.length === 1 &&
        provider.metrics.sentMessages.some((entry) => entry.body.msg.item_list[0]?.type === 2)), {
        timeoutMs: 60_000,
        intervalMs: 100,
        label: "WeChat installed Agent media reply",
      });
      const expectedMd5 = crypto.createHash("md5").update(imageBytes).digest("hex");
      const upload = provider.metrics.uploads[0];
      const uploadRequest = provider.metrics.uploadRequests[0];
      const imageReply = provider.metrics.sentMessages.find((entry) => entry.body.msg.item_list[0]?.type === 2);
      if (upload.size !== imageBytes.length || upload.md5 !== expectedMd5 ||
        uploadRequest.rawsize !== imageBytes.length || uploadRequest.rawfilemd5 !== expectedMd5 ||
        imageReply?.authorization !== "Bearer wechat-e2e-token" ||
        imageReply.body.msg.to_user_id !== "wechat-e2e-user@im.wechat" ||
        imageReply.body.msg.context_token !== "wechat-e2e-context-token") {
        throw new Error("WeChat guarded media upload bytes or Agent image reply mismatch");
      }

      const beforeEscapeUploads = provider.metrics.uploads.length;
      const beforeEscapeUploadRequests = provider.metrics.uploadRequests.length;
      const beforeEscapeImageReplies = provider.metrics.sentMessages.filter((entry) => entry.body.msg.item_list[0]?.type === 2).length;
      const beforeEscapeCompletions = model.metrics.completionsFinished;
      const escapedMessageId = `wechat-e2e-media-escape-${crypto.randomUUID()}`;
      const processedJournal = join(STATE_DIR, "openclaw-weixin", "accounts", "e2e-im-bot.sync.json.processed.json");
      model.controls.replyText = `MEDIA:${escapedFile}`;
      provider.enqueueMessage(escapedMessageId, "请回复允许目录外的媒体");
      await waitForWechatMessageSettlement(
        ctx.waitFor, model.metrics, beforeEscapeCompletions, escapedMessageId, processedJournal,
      );
      if (provider.metrics.uploadRequests.length !== beforeEscapeUploadRequests ||
        provider.metrics.uploads.length !== beforeEscapeUploads ||
        provider.metrics.sentMessages.filter((entry) => entry.body.msg.item_list[0]?.type === 2).length !== beforeEscapeImageReplies ||
        provider.metrics.sentMessages.some((entry) => JSON.stringify(entry.body).includes(escapedFile))) {
        throw new Error("WeChat rejected media escaped into upload, image reply, or text reply");
      }
      model.controls.replyText = "openclaw e2e fixture reply";

      const beforeReplayCompletions = model.metrics.completions;
      const beforeReplayReplies = provider.metrics.replies;
      const beforeReplayDeliveries = provider.metrics.deliveredBatches;

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
      method: "tarball install + getUpdates + Agent Turn + guarded media upload/rejection + context-token reply + Gateway restart dedupe",
    },
    results,
  );
}

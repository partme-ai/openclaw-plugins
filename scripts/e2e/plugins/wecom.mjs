/**
 * 企业微信 Agent Webhook 的跨进程安装态 E2E。
 *
 * 覆盖链路：tarball 安装 → Gateway 动态路由 → AES/SHA1 URL 验证 → 非法签名拒绝 →
 * 加密 XML 入站 → 真实 Agent Turn → MsgId 进程内/重启后持久化防重。
 */
import { createCipheriv, createHash, randomBytes } from "node:crypto";

import { WECOM_E2E_CONFIG } from "../config/plugins/wecom.mjs";
import { ensureGatewayRunning } from "../lib/gateway.mjs";
import { runAdapterTest } from "./_context.mjs";

const WEBHOOK_PATH = "/plugins/wecom/agent";
const PKCS7_BLOCK_SIZE = 32;

/** 按企业微信协议对明文做随机前缀、长度、ReceiveId 封装并执行 AES-256-CBC 加密。 */
function encryptWecom(plainText, timestamp, nonce) {
  const { token, encodingAESKey, corpId } = WECOM_E2E_CONFIG.agent;
  const aesKey = Buffer.from(`${encodingAESKey}=`, "base64");
  const plain = Buffer.from(plainText, "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(plain.length, 0);
  const framed = Buffer.concat([
    randomBytes(16),
    length,
    plain,
    Buffer.from(corpId, "utf8"),
  ]);
  const paddingLength = PKCS7_BLOCK_SIZE - (framed.length % PKCS7_BLOCK_SIZE);
  const padded = Buffer.concat([framed, Buffer.alloc(paddingLength, paddingLength)]);
  const cipher = createCipheriv("aes-256-cbc", aesKey, aesKey.subarray(0, 16));
  cipher.setAutoPadding(false);
  const encrypt = Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
  const signature = createHash("sha1")
    .update([token, timestamp, nonce, encrypt].sort().join(""), "utf8")
    .digest("hex");
  return { encrypt, signature };
}

function callbackPath({ signature, timestamp, nonce, echostr }) {
  const query = new URLSearchParams({ msg_signature: signature, timestamp, nonce });
  if (echostr) query.set("echostr", echostr);
  return `${WEBHOOK_PATH}?${query.toString()}`;
}

async function waitForCompletions(ctx, expected, label) {
  await ctx.waitFor(
    () => Promise.resolve(ctx.modelFixture.metrics.completions === expected),
    { timeoutMs: 60_000, intervalMs: 100, label },
  );
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
export async function testWecom(ctx, results) {
  await runAdapterTest(
    ctx,
    "wecom",
    async () => {
      if (!ctx.modelFixture) throw new Error("WeCom E2E requires the local OpenAI model fixture");

      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = `wecom-e2e-${Date.now()}`;
      const challengeText = "wecom-e2e-url-verification";
      const challenge = encryptWecom(challengeText, timestamp, nonce);
      const verified = await ctx.gatewayFetch(callbackPath({
        signature: challenge.signature,
        timestamp,
        nonce,
        echostr: challenge.encrypt,
      }));
      if (verified.status !== 200 || verified.text !== challengeText) {
        throw new Error(`WeCom URL verification failed: HTTP ${verified.status} ${verified.text}`);
      }

      const invalid = await ctx.gatewayFetch(callbackPath({
        signature: "0".repeat(40),
        timestamp,
        nonce,
        echostr: challenge.encrypt,
      }));
      if (invalid.status !== 401) {
        throw new Error(`invalid WeCom signature was not rejected: HTTP ${invalid.status}`);
      }

      const msgId = String(Date.now());
      const messageXml = [
        "<xml>",
        `<ToUserName><![CDATA[${WECOM_E2E_CONFIG.agent.corpId}]]></ToUserName>`,
        "<FromUserName><![CDATA[wecom-e2e-user]]></FromUserName>",
        `<CreateTime>${timestamp}</CreateTime>`,
        "<MsgType><![CDATA[text]]></MsgType>",
        "<Content><![CDATA[请处理企业微信安装态 E2E 入站消息]]></Content>",
        `<MsgId>${msgId}</MsgId>`,
        `<AgentID>${WECOM_E2E_CONFIG.agent.agentId}</AgentID>`,
        "</xml>",
      ].join("");
      const message = encryptWecom(messageXml, timestamp, nonce);
      const envelope = `<xml><ToUserName><![CDATA[${WECOM_E2E_CONFIG.agent.corpId}]]></ToUserName><Encrypt><![CDATA[${message.encrypt}]]></Encrypt></xml>`;
      const path = callbackPath({ signature: message.signature, timestamp, nonce });
      const completionsBefore = ctx.modelFixture.metrics.completions;
      const accepted = await ctx.gatewayFetch(path, {
        method: "POST",
        headers: { "content-type": "application/xml; charset=utf-8" },
        body: envelope,
      });
      if (accepted.status !== 200 || accepted.text !== "success") {
        throw new Error(`valid WeCom callback was not acknowledged: HTTP ${accepted.status} ${accepted.text}`);
      }
      await waitForCompletions(ctx, completionsBefore + 1, "WeCom Agent Turn completion");
      await ctx.waitFor(
        () => Promise.resolve(ctx.wecomProvider?.metrics.replies === 1),
        { timeoutMs: 10_000, intervalMs: 50, label: "WeCom local OpenAPI reply" },
      );

      // 企业微信可能重试同一 MsgId；同进程重复投递不得再次触发模型。
      const duplicate = await ctx.gatewayFetch(path, {
        method: "POST",
        headers: { "content-type": "application/xml; charset=utf-8" },
        body: envelope,
      });
      if (duplicate.status !== 200) throw new Error(`duplicate WeCom callback ACK failed: ${duplicate.status}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (ctx.modelFixture.metrics.completions !== completionsBefore + 1) {
        throw new Error("duplicate WeCom MsgId triggered a second Agent Turn");
      }

      // 重启 Gateway 后重放，证明防重状态落盘而非只保存在进程内 Map。
      await ensureGatewayRunning();
      const postRestartDuplicate = await ctx.gatewayFetch(path, {
        method: "POST",
        headers: { "content-type": "application/xml; charset=utf-8" },
        body: envelope,
      });
      if (postRestartDuplicate.status !== 200) {
        throw new Error(`post-restart WeCom duplicate ACK failed: ${postRestartDuplicate.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (ctx.modelFixture.metrics.completions !== completionsBefore + 1) {
        throw new Error("post-restart WeCom MsgId bypassed persistent deduplication");
      }
    },
    {
      service: "local encrypted WeCom Agent Webhook + OpenAI-compatible model fixture",
      method: "tarball install + AES/SHA1 callback + Agent Turn + in-process/restart dedupe",
    },
    results,
  );
}

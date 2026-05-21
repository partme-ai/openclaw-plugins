/**
 * Gotify 发送 → 等待 → 回复 薄 E2E（3 步）
 *
 * 用法:
 *   GOTIFY_APP_TOKEN=... GOTIFY_CLIENT_TOKEN=... npx tsx scripts/wait-reply-test.ts
 *   OPENCLAW_TEST_POLL_MS=250 npx tsx scripts/wait-reply-test.ts "自定义消息"
 */

import { createGotifyAdapter } from './standard-test-adapter.js';
import { printGotifyControlUiHint } from './test-ui-hint.js';
import { randomUUID } from 'node:crypto';

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'http://127.0.0.1:18789';
const PEER_ID = process.env.GOTIFY_TEST_PEER_ID ?? process.env.OPENCLAW_TEST_PEER_ID ?? '4';
const TIMEOUT_MS = Number(process.env.OPENCLAW_WAIT_REPLY_TIMEOUT_MS ?? 120_000);

async function main(): Promise<void> {
  const correlationId = randomUUID().slice(0, 8);
  const customMsg = process.argv[2];
  const message =
    customMsg ??
    `【${correlationId}】你好！请用一句话回复，确认你收到了这条 Gotify wait-reply 测试。`;

  console.log('═'.repeat(60));
  console.log('  Gotify wait-reply-test (send → wait → print)');
  console.log(`  timeout=${TIMEOUT_MS}ms poll=${process.env.OPENCLAW_TEST_POLL_MS ?? 250}ms`);
  console.log('═'.repeat(60));

  const adapter = await createGotifyAdapter();
  const ctx = {
    correlationId,
    channel: 'gotify',
    accountId: process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default',
    peerId: PEER_ID,
    agentId: process.env.OPENCLAW_TEST_AGENT_ID ?? 'main',
    caseId: 'wait-reply-manual',
    datasetPath: '',
    vars: { CORRELATION_ID: correlationId },
  };

  console.log('\n[1/3] send');
  const sent = await adapter.send(
    { type: 'text', message, title: 'openclaw-wait-reply-test' },
    ctx
  );
  console.log(`      messageId=${sent.messageId} sent_at=${sent.sentAt}`);

  console.log('\n[2/3] wait');
  const waitStart = Date.now();
  const reply = await adapter.waitForReply(ctx, {
    timeoutMs: TIMEOUT_MS,
    sinceMs: sent.sentAt,
    afterMessageId: sent.messageId,
    excludeMessageIds: [sent.messageId],
  });
  const waitedMs = Date.now() - waitStart;

  if (!reply) {
    console.error(`\n[3/3] FAIL — 等待回复超时 (waited ${waitedMs}ms)`);
    process.exit(1);
  }

  const latencyMs = reply.latencyMs ?? reply.receivedAt - sent.sentAt;
  console.log(
    `      reply_at=${reply.receivedAt} latency_ms=${latencyMs} polls=${reply.pollCount ?? '?'} waited=${waitedMs}ms`
  );

  console.log('\n[3/3] reply');
  console.log('─'.repeat(60));
  console.log(reply.text);
  console.log('─'.repeat(60));

  printGotifyControlUiHint({
    peerId: PEER_ID,
    agentId: ctx.agentId,
    accountId: ctx.accountId,
    sessionLabelHint: 'gotify: e2e-user',
    gatewayUrl: GATEWAY_URL,
  });

  if (adapter.cleanup && reply.messageId) {
    await adapter.cleanup([sent.messageId, reply.messageId]);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

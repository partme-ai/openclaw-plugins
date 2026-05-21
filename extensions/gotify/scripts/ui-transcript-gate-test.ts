/**
 * OpenClaw Gotify — Control UI transcript 验收门禁（发布/验收必过）
 *
 * 流程:
 *   1. 经 Gotify REST 发送用户消息（e2e-user app token）
 *   2. 轮询 chat.history（250ms，最长 120s）
 *   3. PASS：存在 role=user 且文本匹配（或 60s 内任意 user 轮次）
 *   4. FAIL：messages=0 或无 user — 打印 sessionKey 与排查步骤
 *
 * 用法:
 *   GOTIFY_APP_TOKEN=... GOTIFY_CLIENT_TOKEN=... pnpm test:ui-gate
 */

import { randomUUID } from 'node:crypto';

import {
  fetchChatHistory,
  waitForUserTranscript,
  TranscriptGateError,
} from './gateway-transcript.js';
import { printGotifyControlUiHint, resolveGotifySessionKey } from './test-ui-hint.js';

const GOTIFY_URL = process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080';
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'http://127.0.0.1:18789';
const TEST_PEER_ID = process.env.GOTIFY_TEST_PEER_ID ?? process.env.OPENCLAW_TEST_PEER_ID ?? '4';
const APP_TOKEN = process.env.GOTIFY_APP_TOKEN ?? '';
const CLIENT_TOKEN = process.env.GOTIFY_CLIENT_TOKEN ?? '';
const AGENT_ID = process.env.OPENCLAW_TEST_AGENT_ID ?? 'main';
const ACCOUNT_ID = process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default';
const TIMEOUT_MS = Number(process.env.OPENCLAW_UI_GATE_TIMEOUT_MS ?? 120_000);
const POLL_MS = Number(process.env.OPENCLAW_TEST_POLL_MS ?? 250);

if (!APP_TOKEN || !CLIENT_TOKEN) {
  console.error('Error: GOTIFY_APP_TOKEN and GOTIFY_CLIENT_TOKEN are required.');
  console.error('');
  console.error('  测试入站请使用 e2e-user App Token（appid=4），勿用 channels.gotify.appToken（出站 appid=1 会被 echo 过滤）');
  console.error('  示例: GOTIFY_APP_TOKEN=AK-MvdcbyFOfBmQ GOTIFY_CLIENT_TOKEN=C7ErQjzzeoAXCKg pnpm test:ui-gate');
  process.exit(1);
}

async function gotifyRequest(path: string, opts: RequestInit = {}): Promise<Response> {
  const url = `${GOTIFY_URL}${path}`;
  const isGet = !opts.method || opts.method === 'GET';
  const headers: Record<string, string> = {
    'X-Gotify-Key': isGet ? CLIENT_TOKEN : APP_TOKEN,
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  return fetch(url, { ...opts, headers });
}

async function main(): Promise<void> {
  const correlationId = randomUUID().slice(0, 8);
  const initialPeerId = TEST_PEER_ID;

  console.log('='.repeat(60));
  console.log('  openclaw-gotify UI TRANSCRIPT GATE');
  console.log('  验收标准: chat.history 必须含 user 消息（Control UI 同源）');
  console.log(`  预期 peerId (env): ${initialPeerId}`);
  console.log(`  Gotify: ${GOTIFY_URL}`);
  console.log(`  Gateway: ${GATEWAY_URL}`);
  console.log('='.repeat(60));

  const testText = `【ui-gate-${correlationId}】请确认 Control UI transcript 已记录本条用户消息。`;
  const sendAt = Date.now();

  console.log('\n[1/3] 发送 Gotify 入站消息...');
  console.log(`      "${testText}"`);
  const sendRes = await gotifyRequest('/message', {
    method: 'POST',
    body: JSON.stringify({
      message: testText,
      title: 'openclaw-ui-gate',
      priority: 5,
    }),
  });
  if (!sendRes.ok) {
    console.error(`FAIL: Gotify POST /message → ${sendRes.status} ${await sendRes.text()}`);
    process.exit(1);
  }
  const sendData = (await sendRes.json()) as { id: number; appid?: number };
  const routedPeerId = String(sendData.appid ?? initialPeerId);
  const sessionKey = resolveGotifySessionKey({
    agentId: AGENT_ID,
    peerId: routedPeerId,
    accountId: ACCOUNT_ID,
  });

  console.log(`      ✓ sent id=${sendData.id} appid=${routedPeerId}`);
  if (routedPeerId !== initialPeerId) {
    console.log(
      `      ⚠ APP token 对应 appid=${routedPeerId}，非 GOTIFY_TEST_PEER_ID=${initialPeerId}；按 appid 路由 sessionKey`
    );
  }
  console.log(`      sessionKey: ${sessionKey}`);

  console.log(`\n[2/3] 轮询 chat.history (${POLL_MS}ms, max ${TIMEOUT_MS / 1000}s)...`);
  try {
    const result = await waitForUserTranscript({
      sessionKey,
      sentText: testText,
      sinceMs: sendAt - 2_000,
      timeoutMs: TIMEOUT_MS,
      pollMs: POLL_MS,
    });

    console.log('\n[3/3] PASS — UI transcript 验收通过');
    console.log(`      sessionKey:     ${result.history.sessionKey}`);
    console.log(`      sessionId:      ${result.history.sessionId ?? '(n/a)'}`);
    console.log(`      label:          ${result.history.conversationLabel ?? '(see Sessions list)'}`);
    console.log(`      messageCount:   ${result.history.messages.length}`);
    console.log(`      lastUserText:   ${result.userText.slice(0, 200)}`);
    console.log(`      polls:          ${result.polls}`);
    console.log(`      waited:         ${result.waitedMs}ms`);

    const snippet = {
      sessionKey: result.history.sessionKey,
      sessionId: result.history.sessionId,
      messageCount: result.history.messages.length,
      lastUser: {
        role: result.userMessage.role,
        text: result.userText.slice(0, 120),
        timestamp: result.userMessage.timestamp,
        senderLabel: result.userMessage.senderLabel,
      },
      recentTail: result.history.messages.slice(-3).map((m) => ({
        role: m.role,
        text: m.content?.[0]?.text?.slice(0, 80),
      })),
    };
    console.log('\n  chat.history 证据:');
    console.log(JSON.stringify(snippet, null, 2));

    printGotifyControlUiHint({
      peerId: routedPeerId,
      agentId: AGENT_ID,
      accountId: ACCOUNT_ID,
      gatewayUrl: GATEWAY_URL,
      sessionLabelHint: 'gotify: e2e-user',
    });

    console.log('='.repeat(60));
    console.log('  ✅ test:ui-gate PASSED — Control UI 应可见上述 user 消息');
    console.log('='.repeat(60));
  } catch (err) {
    if (err instanceof TranscriptGateError) {
      console.error('\n' + err.message);
      if (err.lastHistory) {
        console.error('\n  chat.history 快照:');
        console.error(
          JSON.stringify(
            {
              sessionKey: err.lastHistory.sessionKey,
              messageCount: err.lastHistory.messages.length,
              messages: err.lastHistory.messages.slice(-5),
            },
            null,
            2
          )
        );
      }
    } else {
      console.error('\nFAIL:', err);
    }

    printGotifyControlUiHint({
      peerId: TEST_PEER_ID,
      agentId: AGENT_ID,
      accountId: ACCOUNT_ID,
      gatewayUrl: GATEWAY_URL,
    });

    try {
      const baseline = await fetchChatHistory({ sessionKey, limit: 5 });
      console.error(`\n  当前 session 已有 ${baseline.messages.length} 条（可能看错会话或 dmScope 不一致）`);
    } catch {
      /* ignore */
    }

    process.exit(1);
  }
}

main().catch((err) => {
  console.error('ui-transcript-gate crashed:', err);
  process.exit(1);
});

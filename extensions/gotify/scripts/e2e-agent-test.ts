/**
 * openclaw-gotify 端到端智能体通信测试
 *
 * 测试流程：
 *   1. 记录当前 Gotify 最新消息时间
 *   2. 通过 Gotify REST API 发送测试消息
 *   3. openclaw-gotify 插件通过 WebSocket stream 接收
 *   4. 路由到 gotify 对端会话（dmScope=per-account-channel-peer 时：
 *      agent:main:gotify:default:direct:<appid>，非默认 main）
 *   5. **验收门禁**：chat.history 必须出现 user 消息（Control UI 同源）
 *   6. 智能体处理并回复（可选，LLM 失败时 user 仍须在 transcript）
 *   7. 回复通过 Gotify outbound 发回
 *   8. 轮询 Gotify 消息，验证回复出现
 *
 * 用法：
 *   npx tsx scripts/e2e-agent-test.ts
 *
 * 在 Control UI 查看对话：http://127.0.0.1:18789 → Sessions → 选 gotify 会话（非 main）
 * 可选 OPENCLAW_TEST_VISIBLE=1 保留 Gotify 服务器上的消息
 */

import { printGotifyControlUiHint, resolveGotifySessionKey } from './test-ui-hint.js';
import {
  waitForUserTranscript,
  TranscriptGateError,
} from './gateway-transcript.js';

const GOTIFY_URL = process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080';
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'http://127.0.0.1:18789';
const TEST_PEER_ID = process.env.GOTIFY_TEST_PEER_ID ?? process.env.OPENCLAW_TEST_PEER_ID ?? '4';
const AGENT_ID = process.env.OPENCLAW_TEST_AGENT_ID ?? 'main';
const ACCOUNT_ID = process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default';
const APP_TOKEN = process.env.GOTIFY_APP_TOKEN ?? '';
const CLIENT_TOKEN = process.env.GOTIFY_CLIENT_TOKEN ?? '';

if (!APP_TOKEN || !CLIENT_TOKEN) {
  console.error('Error: GOTIFY_APP_TOKEN and GOTIFY_CLIENT_TOKEN are required.');
  console.error('Usage: GOTIFY_APP_TOKEN=<token> GOTIFY_CLIENT_TOKEN=<token> npx tsx scripts/e2e-agent-test.ts');
  process.exit(1);
}
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = Number(process.env.OPENCLAW_TEST_POLL_MS ?? 250);
const TRANSCRIPT_TIMEOUT_MS = Number(process.env.OPENCLAW_UI_GATE_TIMEOUT_MS ?? POLL_TIMEOUT_MS);

async function gotifyRequest(path: string, opts: RequestInit = {}): Promise<Response> {
  const url = `${GOTIFY_URL}${path}`;
  const isGet = !opts.method || opts.method === 'GET';
  const headers: Record<string, string> = {
    "X-Gotify-Key": isGet ? CLIENT_TOKEN : APP_TOKEN,
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  return fetch(url, { ...opts, headers });
}

async function main() {
  const initialPeerId = TEST_PEER_ID;

  console.log("=".repeat(60));
  console.log("  openclaw-gotify 端到端智能体通信测试");
  console.log("  Gotify:", GOTIFY_URL);
  console.log("  Model: (agent main 配置)");
  console.log("  Agent:", AGENT_ID);
  console.log("  预期 peerId (env):", initialPeerId);
  printGotifyControlUiHint({ peerId: initialPeerId, gatewayUrl: GATEWAY_URL, agentId: AGENT_ID, accountId: ACCOUNT_ID });
  console.log("=".repeat(60));

  // 1. 健康检查
  console.log("\n🔍 健康检查...");
  const health = await gotifyRequest("/health");
  console.log(`   Gotify: ${JSON.stringify(await health.json())}`);

  // 2. 记录发送前的消息快照
  console.log("\n📸 记录消息快照...");
  const beforeRes = await gotifyRequest("/message?limit=3");
  const beforeData = await beforeRes.json();
  const beforeIds = new Set(
    (beforeData.messages ?? []).map((m: { id: number }) => m.id),
  );
  console.log(`   已有消息 ID: ${[...beforeIds].join(", ") || "(空)"}`);

  // 3. 发送测试消息到 Gotify（模拟用户通过 Gotify 推送）
  const testText = "你好！请用一句话回复我，确认你收到了这条来自 Gotify 通道的测试消息。";
  const sendAt = Date.now();
  console.log(`\n📤 发送测试消息:`);
  console.log(`   "${testText}"`);

  const sendRes = await gotifyRequest("/message", {
    method: "POST",
    body: JSON.stringify({
      message: testText,
      title: "openclaw-e2e-test",
      priority: 5,
    }),
  });
  const sendData = await sendRes.json();
  const routedPeerId = String(sendData.appid ?? initialPeerId);
  const sessionKey = resolveGotifySessionKey({
    agentId: AGENT_ID,
    peerId: routedPeerId,
    accountId: ACCOUNT_ID,
  });
  console.log(`   ✓ 已发送 (id=${sendData.id}, appid=${routedPeerId})`);
  console.log(`   sessionKey: ${sessionKey}`);
  if (routedPeerId !== initialPeerId) {
    console.log(`   ⚠ APP token 路由到 appid=${routedPeerId}，非 GOTIFY_TEST_PEER_ID=${initialPeerId}`);
  }

  // 4. UI transcript 门禁 — 必须早于/并行于 Gotify 回复轮询
  console.log(`\n📋 验收 chat.history（Control UI 同源，poll=${POLL_INTERVAL_MS}ms）...`);
  let transcriptOk = false;
  let transcriptUserText = '';
  try {
    const transcript = await waitForUserTranscript({
      sessionKey,
      sentText: testText,
      sinceMs: sendAt - 2_000,
      timeoutMs: TRANSCRIPT_TIMEOUT_MS,
      pollMs: POLL_INTERVAL_MS,
    });
    transcriptOk = true;
    transcriptUserText = transcript.userText;
    console.log(`   ✓ user 消息已写入 transcript (${transcript.polls} polls, ${transcript.waitedMs}ms)`);
    console.log(`   ✓ lastUserText: "${transcriptUserText.slice(0, 120)}"`);
  } catch (err) {
    if (err instanceof TranscriptGateError) {
      console.log(`   ✗ FAIL: ${err.message}`);
    } else {
      console.log(`   ✗ FAIL: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 5. 等待智能体处理并回复（Gotify 出站）
  console.log(`\n⏳ 等待 Agent Gotify 回复（最长 ${POLL_TIMEOUT_MS / 1000}s, poll=${POLL_INTERVAL_MS}ms）...`);
  const startTime = Date.now();
  let agentReply: string | null = null;
  let replyId: number | null = null;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await gotifyRequest("/message?limit=10");
    const pollData = await pollRes.json();
    const messages: Array<{ id: number; message: string; date: string }> = pollData.messages ?? [];

    for (const msg of messages) {
      if (msg.id === sendData.id) continue;
      if (beforeIds.has(msg.id)) continue;

      agentReply = msg.message;
      replyId = msg.id;
      break;
    }

    if (agentReply) break;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed > 0 && elapsed % 15 === 0) {
      console.log(`   ...等待中 (${elapsed}s)`);
    }
  }

  // 6. 验证结果
  console.log("\n✅ 验证:");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`   ✓ ${label}`);
      passed++;
    } else {
      console.log(`   ✗ FAIL: ${label}`);
      failed++;
    }
  }

  assert(sendData.id > 0, "测试消息发送成功");
  assert(transcriptOk, `Control UI transcript 含 user 消息 (sessionKey=${sessionKey})`);
  assert(agentReply !== null, `智能体有 Gotify 回复 (id=${replyId})`);

  if (agentReply) {
    console.log(`\n📥 Agent 回复:`);
    console.log(`   "${agentReply.substring(0, 300)}"`);
    console.log(`   (长度: ${agentReply.length} 字符)`);

    assert(agentReply.length > 5, "回复内容长度合理 (>5)");
    assert(
      agentReply.includes("Gotify") ||
        agentReply.includes("gotify") ||
        agentReply.includes("通道") ||
        agentReply.includes("消息") ||
        agentReply.includes("测试") ||
        agentReply.includes("收到") ||
        agentReply.length > 20,
      "回复与测试消息相关",
    );
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n   总耗时: ${elapsed}s`);

  // 7. 清理测试消息（OPENCLAW_TEST_VISIBLE=1 时保留，便于 Gotify App 对照）
  const keepVisible = process.env.OPENCLAW_TEST_VISIBLE === '1';
  if (!keepVisible) {
    if (replyId) {
      await gotifyRequest(`/message/${replyId}`, { method: "DELETE" }).catch(() => {});
    }
    await gotifyRequest(`/message/${sendData.id}`, { method: "DELETE" }).catch(() => {});
  }

  printGotifyControlUiHint({
    peerId: routedPeerId,
    gatewayUrl: GATEWAY_URL,
    agentId: AGENT_ID,
    accountId: ACCOUNT_ID,
    sessionLabelHint: 'gotify: e2e-user',
  });

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  结果: ${passed}/${passed + failed} 通过`);
  if (failed > 0) {
    console.log(`  ❌ 端到端测试失败（无 transcript = UI 无消息，见 pnpm test:ui-gate）`);
    process.exit(1);
  } else {
    console.log("  ✅ 端到端智能体通信测试通过！");
  }
  console.log("=".repeat(60));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("测试崩溃:", err);
  process.exit(1);
});

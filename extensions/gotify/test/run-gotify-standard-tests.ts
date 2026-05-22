/**
 * Gotify 标准测试套件入口 — 薄包装 runStandardTests + Gotify ChannelAdapter
 *
 * 用法:
 *   GOTIFY_APP_TOKEN=Axxx GOTIFY_CLIENT_TOKEN=Cxxx pnpm test:standard
 *   OPENCLAW_TEST_TIERS=L0,L1,L2,L3 pnpm test:standard
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runStandardTests,
  type StandardTestCase,
  type TestCaseResult,
  type TestContext,
} from '../../../testing/scripts/run-standard-tests.js';
import { createGotifyAdapter } from './standard-test-adapter.js';
import { waitForUserTranscript, TranscriptGateError } from './gateway-transcript.js';
import { printGotifyControlUiHint, resolveGotifySessionKey } from './test-ui-hint.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATASET = resolve(__dirname, '../../../testing/test-dataset.yaml');

function parseList(envVal: string | undefined): string[] | undefined {
  if (!envVal?.trim()) return undefined;
  return envVal.split(',').map((s) => s.trim()).filter(Boolean);
}

/** e2e-user 等测试应用在 Gotify 上的 appid，用于 UI sessionKey 提示。 */
const DEFAULT_TEST_PEER_ID = process.env.GOTIFY_TEST_PEER_ID ?? '4';

/** L1+ Agent 用例结束后是否强制 chat.history 验收（默认开启；OPENCLAW_REQUIRE_UI_TRANSCRIPT=0 关闭）。 */
const REQUIRE_UI_TRANSCRIPT = process.env.OPENCLAW_REQUIRE_UI_TRANSCRIPT !== '0';

let lastAgentCaseCtx: TestContext | null = null;
let lastAgentSentAt = 0;
let lastAgentSentText = '';
let lastAgentCaseId = '';

/**
 * L1+ 且触发 Agent 往返的用例结束后，打印 Control UI 会话定位提示并记录 transcript 验收上下文。
 */
function onGotifyCaseEnd(tc: StandardTestCase, result: TestCaseResult, ctx: TestContext): void {
  if (result.status !== 'pass') return;
  if (tc.tier === 'L0') return;
  const invokesAgent =
    tc.expected.reply_received !== false ||
    tc.input.type === 'multi_turn' ||
    Boolean(tc.expected.agent_invoked);
  if (!invokesAgent) return;

  lastAgentCaseCtx = ctx;
  lastAgentCaseId = tc.id;
  lastAgentSentAt = result.sent_at ?? Date.now();
  lastAgentSentText = tc.input.message ?? tc.input.turns?.[0]?.message ?? '';

  const peerId = process.env.OPENCLAW_TEST_PEER_ID?.trim() || DEFAULT_TEST_PEER_ID;
  printGotifyControlUiHint({
    peerId,
    agentId: ctx.agentId,
    accountId: ctx.accountId,
    sessionLabelHint: 'gotify: e2e-user（或你的 Gotify 应用名）',
  });
}

/**
 * 标准测试全部通过后，对最后一次 L1+ Agent 用例做 chat.history 验收。
 */
async function verifyUiTranscriptGate(): Promise<number> {
  if (!REQUIRE_UI_TRANSCRIPT || !lastAgentCaseCtx) {
    return 0;
  }

  const peerId = process.env.OPENCLAW_TEST_PEER_ID?.trim() || DEFAULT_TEST_PEER_ID;
  const sessionKey = resolveGotifySessionKey({
    agentId: lastAgentCaseCtx.agentId,
    peerId,
    accountId: lastAgentCaseCtx.accountId,
  });

  console.log('');
  console.log('─'.repeat(60));
  console.log(`  UI transcript gate (case ${lastAgentCaseId})`);
  console.log(`  sessionKey: ${sessionKey}`);

  try {
    const result = await waitForUserTranscript({
      sessionKey,
      sentText: lastAgentSentText || undefined,
      sinceMs: lastAgentSentAt - 5_000,
      timeoutMs: Number(process.env.OPENCLAW_UI_GATE_TIMEOUT_MS ?? 30_000),
      pollMs: Number(process.env.OPENCLAW_TEST_POLL_MS ?? 250),
    });
    console.log(`  ✓ chat.history 含 user 消息 (${result.history.messages.length} msgs, ${result.polls} polls)`);
    console.log(`  ✓ lastUserText: "${result.userText.slice(0, 100)}"`);
    console.log('─'.repeat(60));
    return 0;
  } catch (err) {
    if (err instanceof TranscriptGateError) {
      console.error(`  ✗ ${err.message}`);
    } else {
      console.error(`  ✗ UI transcript gate failed:`, err);
    }
    console.error('  提示: 单独运行 pnpm test:ui-gate 做完整验收');
    console.log('─'.repeat(60));
    return 1;
  }
}

async function main(): Promise<void> {
  const tiers = parseList(process.env.OPENCLAW_TEST_TIERS);
  const ids = parseList(process.env.OPENCLAW_TEST_IDS);
  const datasetPath = process.env.OPENCLAW_TEST_DATASET ?? DEFAULT_DATASET;

  console.log('');
  console.log('  ℹ️  Gotify 标准测试不会写入默认 main 会话；完成后请在 Control UI → Sessions');
  console.log(`     选择 gotify 会话（常见 peerId=${DEFAULT_TEST_PEER_ID}，见每条 PASS 后的指引）`);
  if (process.env.OPENCLAW_TEST_VISIBLE === '1') {
    console.log('  ℹ️  OPENCLAW_TEST_VISIBLE=1：runner 不 cleanup；插件仍消费即删（历史在 Control UI）');
  }
  console.log('  ℹ️  L10 多轮：需 Gateway 运行 + 已配置 LLM；超时见 test-dataset multi_turn_reply_max_ms');
  console.log('  ℹ️  轮询默认 250ms（OPENCLAW_TEST_POLL_MS），适配消费即删下的短窗口回复');
  console.log('  ℹ️  L1-RT：OPENCLAW_TEST_IDS=L1-RT-01,L1-RT-02,L1-RT-03 或 OPENCLAW_TEST_TIERS=L1');
  console.log('  ℹ️  薄 E2E：npx tsx scripts/wait-reply-test.ts');
  console.log('  ℹ️  发布/验收必过：pnpm test:ui-gate（vitest 91 条 ≠ Control UI 有消息）');
  if (REQUIRE_UI_TRANSCRIPT) {
    console.log('  ℹ️  L1+ 结束后自动 chat.history 验收（OPENCLAW_REQUIRE_UI_TRANSCRIPT=0 可关闭）');
  }
  console.log('');

  const adapter = await createGotifyAdapter();
  const { exitCode } = await runStandardTests(adapter, {
    datasetPath,
    tiers,
    ids,
    skipManual: process.env.OPENCLAW_TEST_INCLUDE_MANUAL === '1' ? false : true,
    timeoutMultiplier: Number(process.env.OPENCLAW_TEST_TIMEOUT_MULTIPLIER ?? 1),
    onCaseEndWithContext: (result, tc, ctx) => onGotifyCaseEnd(tc, result, ctx),
  });

  let finalExit = exitCode;
  if (exitCode === 0) {
    finalExit = await verifyUiTranscriptGate();
  }

  if (finalExit === 0 && lastAgentCaseCtx) {
    const peerId = process.env.OPENCLAW_TEST_PEER_ID?.trim() || DEFAULT_TEST_PEER_ID;
    printGotifyControlUiHint({
      peerId,
      agentId: lastAgentCaseCtx.agentId,
      accountId: lastAgentCaseCtx.accountId,
      sessionLabelHint: 'gotify: e2e-user',
    });
  }

  process.exit(finalExit);
}

main().catch((err) => {
  console.error('Standard test runner crashed:', err);
  process.exit(1);
});

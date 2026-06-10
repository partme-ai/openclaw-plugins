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
  interpolate,
  loadDataset,
  type StandardTestCase,
  type TestCaseResult,
  type TestContext,
} from '../../../testing/scripts/run-standard-tests.js';
import { createGotifyAdapter } from './standard-test-adapter.js';
import { waitForUserTranscript, TranscriptGateError } from './gateway-transcript.js';
import { printGotifyControlUiHint, resolveGotifySessionKey } from './test-ui-hint.js';
import { fetchChatHistory, extractMessageText } from './gateway-transcript.js';
import { getMessages } from '../src/transport/gotify-api.js';
import { resolveGotifyAccount } from '../src/config.js';
import { buildMessage, type UnifiedMessage } from '@partme.ai/openclaw-message-sdk';
import { mapGotifyStreamToUnified } from '../src/dispatch/routing/message-mapper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATASET = resolve(__dirname, './gotify-standard-dataset.yaml');

function parseList(envVal: string | undefined): string[] | undefined {
  if (!envVal?.trim()) return undefined;
  return envVal.split(',').map((s) => s.trim()).filter(Boolean);
}

/** e2e-user 等测试应用在 Gotify 上的 appid，用于 UI sessionKey 提示。 */
const DEFAULT_TEST_PEER_ID =
  process.env.GOTIFY_TEST_PEER_ID ?? process.env.OPENCLAW_TEST_PEER_ID ?? '4';

/** L1+ Agent 用例结束后是否强制 chat.history 验收（默认开启；OPENCLAW_REQUIRE_UI_TRANSCRIPT=0 关闭）。 */
const REQUIRE_UI_TRANSCRIPT = process.env.OPENCLAW_REQUIRE_UI_TRANSCRIPT !== '0';

let lastAgentCaseCtx: TestContext | null = null;
let lastAgentSentAt = 0;
let lastAgentSentText = '';
let lastAgentCaseId = '';
const finishedCases: Array<{
  tc: StandardTestCase;
  result: TestCaseResult;
  ctx: TestContext;
}> = [];

type GotifyAssertions = {
  require_main_agent?: boolean;
  session_key_equals?: string;
  transcript_min_messages?: number;
  transcript_user_contains?: string;
  transcript_assistant_contains_any?: string[];
  main_session_must_not_contain_correlation?: boolean;
  message_list_title?: string;
  message_list_expected_count_by_title?: number;
  message_list_expected_reply_count_by_title?: number;
  message_list_require_user_visible?: boolean;
  message_list_require_reply_visible?: boolean;
  message_list_reply_matches_transcript?: boolean;
  message_list_distinct_ids?: boolean;
};

type SdkMessageSource = {
  channel: string;
  accountId: string;
  userId: string;
  chatType: string;
  agentId?: string;
};

type SdkMessageShape = {
  source: SdkMessageSource;
  contentType: string;
  text: string;
  markdown?: string;
  media: unknown[];
  direction: string;
  metadata?: Record<string, unknown>;
};

type SdkExpectedReplyShape = {
  source: SdkMessageSource;
  contentType: string;
  text_rule?: 'non_empty';
  media: unknown[];
  direction: string;
};

type ChannelExpectedPayload = {
  title?: string;
  priority?: number;
  extras?: {
    openclaw?: {
      outbound?: boolean;
      source?: string;
    };
  };
};

type GotifyMessageRecord = {
  id?: number | string;
  appid?: number | string;
  message?: string;
  title?: string;
  priority?: number;
  extras?: Record<string, unknown>;
  date?: string;
};

function validateSdkShape(dataset: Awaited<ReturnType<typeof loadDataset>>): void {
  for (const tc of dataset.test_cases) {
    const withSdk = tc as StandardTestCase & {
      sdk_inbound?: SdkMessageShape;
      sdk_inbound_sequence?: SdkMessageShape[];
      sdk_expected_reply?: SdkExpectedReplyShape;
      channel_expected_payload?: ChannelExpectedPayload;
    };

    const sequence = withSdk.sdk_inbound_sequence;
    const inboundItems = sequence?.length ? sequence : withSdk.sdk_inbound ? [withSdk.sdk_inbound] : [];
    if (inboundItems.length === 0) {
      throw new Error(`${tc.id}: missing sdk_inbound or sdk_inbound_sequence`);
    }
    for (const [index, item] of inboundItems.entries()) {
      if (item.source.channel !== 'gotify') {
        throw new Error(`${tc.id}: sdk_inbound[${index}] source.channel must be gotify`);
      }
      if (item.direction !== 'inbound') {
        throw new Error(`${tc.id}: sdk_inbound[${index}] direction must be inbound`);
      }
      if (!['text', 'markdown', 'mixed'].includes(item.contentType)) {
        throw new Error(`${tc.id}: sdk_inbound[${index}] contentType invalid: ${item.contentType}`);
      }
      if (typeof item.text !== 'string') {
        throw new Error(`${tc.id}: sdk_inbound[${index}] text must be string`);
      }
      if (!Array.isArray(item.media)) {
        throw new Error(`${tc.id}: sdk_inbound[${index}] media must be array`);
      }
      if (item.source.agentId && item.source.agentId !== 'main') {
        throw new Error(`${tc.id}: sdk_inbound[${index}] source.agentId must be main for this suite`);
      }
    }

    if (!withSdk.sdk_expected_reply) {
      throw new Error(`${tc.id}: missing sdk_expected_reply`);
    }
    if (withSdk.sdk_expected_reply.direction !== 'outbound') {
      throw new Error(`${tc.id}: sdk_expected_reply.direction must be outbound`);
    }
    if (!['text', 'markdown', 'mixed'].includes(withSdk.sdk_expected_reply.contentType)) {
      throw new Error(`${tc.id}: sdk_expected_reply.contentType invalid: ${withSdk.sdk_expected_reply.contentType}`);
    }
    if (withSdk.sdk_expected_reply.source.channel !== 'gotify') {
      throw new Error(`${tc.id}: sdk_expected_reply.source.channel must be gotify`);
    }
    if (withSdk.sdk_expected_reply.source.agentId && withSdk.sdk_expected_reply.source.agentId !== 'main') {
      throw new Error(`${tc.id}: sdk_expected_reply.source.agentId must be main`);
    }
    if (withSdk.sdk_expected_reply.direction !== 'outbound') {
      throw new Error(`${tc.id}: sdk_expected_reply.direction must be outbound`);
    }
    if (!Array.isArray(withSdk.sdk_expected_reply.media)) {
      throw new Error(`${tc.id}: sdk_expected_reply.media must be array`);
    }
  }
}

function materializeActualInboundUnified(
  accountId: string,
  peerId: string,
  message: GotifyMessageRecord,
): UnifiedMessage {
  return mapGotifyStreamToUnified({
    accountId,
    peerId,
    agentId: 'main',
    message,
  });
}

function materializeActualOutboundUnified(
  accountId: string,
  peerId: string,
  expectedContentType: string,
  message: GotifyMessageRecord,
): UnifiedMessage {
  const text = String(message.message ?? '');
  if (expectedContentType === 'markdown') {
    const built = buildMessage({
      channel: 'gotify',
      accountId,
      userId: peerId,
      agentId: 'main',
      markdown: text,
      chatType: 'direct',
      direction: 'outbound',
      metadata: {
        gotifyId: message.id,
        gotifyAppId: message.appid,
        title: message.title,
        priority: message.priority,
        extras: message.extras,
        date: message.date,
      },
    });
    return {
      ...built,
      text,
      markdown: text,
      contentType: 'markdown',
    };
  }

  const built = buildMessage({
    channel: 'gotify',
    accountId,
    userId: peerId,
    agentId: 'main',
    text,
    chatType: 'direct',
    direction: 'outbound',
    metadata: {
      gotifyId: message.id,
      gotifyAppId: message.appid,
      title: message.title,
      priority: message.priority,
      extras: message.extras,
      date: message.date,
    },
  });
  return {
    ...built,
    contentType: expectedContentType as UnifiedMessage['contentType'],
  };
}

function assertUnifiedShape(
  expected: SdkMessageShape | SdkExpectedReplyShape,
  actual: UnifiedMessage,
  label: string,
): string[] {
  const failures: string[] = [];
  if (actual.source.channel !== expected.source.channel) {
    failures.push(`${label}.source.channel expected ${expected.source.channel}, got ${actual.source.channel}`);
  }
  if (actual.source.accountId !== expected.source.accountId) {
    failures.push(`${label}.source.accountId expected ${expected.source.accountId}, got ${actual.source.accountId}`);
  }
  if (actual.source.userId !== expected.source.userId) {
    failures.push(`${label}.source.userId expected ${expected.source.userId}, got ${actual.source.userId}`);
  }
  if (actual.source.chatType !== expected.source.chatType) {
    failures.push(`${label}.source.chatType expected ${expected.source.chatType}, got ${actual.source.chatType}`);
  }
  if (expected.source.agentId && actual.source.agentId !== expected.source.agentId) {
    failures.push(`${label}.source.agentId expected ${expected.source.agentId}, got ${String(actual.source.agentId ?? '')}`);
  }
  if (actual.direction !== expected.direction) {
    failures.push(`${label}.direction expected ${expected.direction}, got ${actual.direction}`);
  }
  if (actual.contentType !== expected.contentType) {
    failures.push(`${label}.contentType expected ${expected.contentType}, got ${actual.contentType}`);
  }
  if (!Array.isArray(actual.media)) {
    failures.push(`${label}.media must be array`);
  }
  if ('text_rule' in expected && expected.text_rule === 'non_empty' && !actual.text.trim()) {
    failures.push(`${label}.text expected non-empty`);
  }
  if ('text' in expected && typeof expected.text === 'string' && !actual.text.includes(expected.text)) {
    failures.push(`${label}.text does not include expected text fragment`);
  }
  return failures;
}

/**
 * L1+ 且触发 Agent 往返的用例结束后，打印 Control UI 会话定位提示并记录 transcript 验收上下文。
 */
function onGotifyCaseEnd(tc: StandardTestCase, result: TestCaseResult, ctx: TestContext): void {
  finishedCases.push({ tc, result, ctx });
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

function buildAccount() {
  const accountId = process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default';
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          ...(accountId === 'default'
            ? {
                serverUrl: process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080',
                appToken: process.env.GOTIFY_APP_TOKEN ?? '',
                clientToken: process.env.GOTIFY_CLIENT_TOKEN ?? '',
              }
            : {
                accounts: {
                  [accountId]: {
                    serverUrl: process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080',
                    appToken: process.env.GOTIFY_APP_TOKEN ?? '',
                    clientToken: process.env.GOTIFY_CLIENT_TOKEN ?? '',
                  },
                },
              }),
        },
      },
    },
    accountId,
  );
}

function interpolateValue(value: string, tc: StandardTestCase, ctx: TestContext): string {
  return interpolate(value, ctx, tc.input);
}

async function verifyGotifyAssertions(): Promise<number> {
  const account = buildAccount();
  let failures = 0;

  for (const item of finishedCases) {
    if (item.result.status !== 'pass') continue;
    const assertions = (item.tc as StandardTestCase & { gotify_assertions?: GotifyAssertions }).gotify_assertions;
    const withSdk = item.tc as StandardTestCase & {
      sdk_expected_reply?: SdkExpectedReplyShape;
      channel_expected_payload?: ChannelExpectedPayload;
    };
    if (!assertions) continue;

    const sessionKey = assertions.session_key_equals
      ? interpolateValue(assertions.session_key_equals, item.tc, item.ctx)
      : resolveGotifySessionKey({
          agentId: item.ctx.agentId,
          peerId: item.ctx.peerId,
          accountId: item.ctx.accountId,
        });

    const fail = (message: string) => {
      failures += 1;
      console.error(`  ✗ ${item.tc.id}: ${message}`);
    };

    console.log(`  → Gotify assertions: ${item.tc.id}`);

    if (assertions.require_main_agent && item.ctx.agentId !== 'main') {
      fail(`expected agentId=main, got ${item.ctx.agentId}`);
      continue;
    }

    const transcript = await fetchChatHistory({
      sessionKey,
      limit: 50,
      gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    });
    const transcriptTexts = transcript.messages.map((m) => ({
      role: m.role,
      text: extractMessageText(m),
    }));

    if (assertions.transcript_min_messages !== undefined &&
      transcript.messages.length < assertions.transcript_min_messages) {
      fail(`transcript messages ${transcript.messages.length} < ${assertions.transcript_min_messages}`);
    }

    if (assertions.transcript_user_contains) {
      const expected = interpolateValue(assertions.transcript_user_contains, item.tc, item.ctx);
      const ok = transcriptTexts.some((m) => m.role === 'user' && m.text.includes(expected));
      if (!ok) fail(`transcript missing user text containing: ${expected}`);
    }

    if (assertions.transcript_assistant_contains_any?.length) {
      const expects = assertions.transcript_assistant_contains_any.map((s) =>
        interpolateValue(s, item.tc, item.ctx),
      );
      const ok = transcriptTexts.some(
        (m) => m.role === 'assistant' && expects.some((s) => m.text.includes(s)),
      );
      if (!ok) fail(`transcript missing assistant text containing any of: ${expects.join(', ')}`);
    }

    if (assertions.main_session_must_not_contain_correlation) {
      const mainTranscript = await fetchChatHistory({
        sessionKey: 'agent:main:main',
        limit: 50,
        gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
      });
      const correlation = item.ctx.correlationId;
      const leaked = mainTranscript.messages.some((m) =>
        extractMessageText(m).includes(correlation),
      );
      if (leaked) fail(`correlation ${correlation} leaked into agent:main:main`);
    }

    const messages = (await getMessages(account, { limit: 50 })).messages;
    const title = assertions.message_list_title
      ? interpolateValue(assertions.message_list_title, item.tc, item.ctx)
      : item.tc.input.title;
    const titled = title
      ? messages.filter((m) => String(m.title ?? '') === title)
      : messages;

    if (assertions.message_list_expected_count_by_title !== undefined &&
      titled.length !== assertions.message_list_expected_count_by_title) {
      fail(`message list count for title "${title}" expected ${assertions.message_list_expected_count_by_title}, got ${titled.length}`);
    }

    const expectedUserText =
      item.tc.input.type === 'text' && item.tc.input.message
        ? interpolateValue(item.tc.input.message, item.tc, item.ctx)
        : item.tc.input.type === 'multi_turn' && item.tc.input.turns?.[0]?.message
          ? interpolateValue(item.tc.input.turns[0].message, item.tc, item.ctx)
          : undefined;

    const assistantTexts = transcriptTexts
      .filter((m) => m.role === 'assistant' && m.text.trim())
      .map((m) => m.text.trim());

    const visibleUser = expectedUserText
      ? titled.find((m) => String(m.message ?? '').includes(expectedUserText))
      : undefined;
    const visibleReply = titled.find((m) => {
      const text = String(m.message ?? '').trim();
      if (!text) return false;
      if (expectedUserText && text === expectedUserText.trim()) return false;
      return assistantTexts.some((assistant) => assistant === text);
    });

    if (assertions.message_list_require_user_visible && !visibleUser) {
      fail(`message list missing visible user message for title "${title}"`);
    }

    if (assertions.message_list_require_reply_visible && !visibleReply) {
      fail(`message list missing visible assistant reply for title "${title}"`);
    }

    if (assertions.message_list_reply_matches_transcript && visibleReply) {
      const ok = assistantTexts.some((text) => text === String(visibleReply.message ?? '').trim());
      if (!ok) fail(`visible reply does not match transcript assistant text`);
    }

    if (visibleReply && withSdk.sdk_expected_reply) {
      if (withSdk.sdk_expected_reply.text_rule === 'non_empty' && !String(visibleReply.message ?? '').trim()) {
        fail(`visible reply message is empty but sdk_expected_reply requires non_empty`);
      }
      if (withSdk.sdk_expected_reply.contentType === 'markdown') {
        const replyText = String(visibleReply.message ?? '');
        if (!replyText.includes('#') && !replyText.includes('|') && !replyText.includes('- ')) {
          fail(`sdk_expected_reply.contentType=markdown but visible reply does not look like markdown`);
        }
      }
    }

    if (visibleReply && withSdk.channel_expected_payload) {
      const expectedPayload = withSdk.channel_expected_payload;
      if (expectedPayload.title && String(visibleReply.title ?? '') !== expectedPayload.title) {
        fail(`channel_expected_payload.title expected "${expectedPayload.title}", got "${String(visibleReply.title ?? '')}"`);
      }
      if (
        expectedPayload.priority !== undefined &&
        Number(visibleReply.priority) !== expectedPayload.priority
      ) {
        fail(`channel_expected_payload.priority expected ${expectedPayload.priority}, got ${String(visibleReply.priority)}`);
      }
      const outboundMeta = (visibleReply.extras as Record<string, unknown> | undefined)?.openclaw as
        | Record<string, unknown>
        | undefined;
      if (expectedPayload.extras?.openclaw?.outbound === true && outboundMeta?.outbound !== true) {
        fail(`channel_expected_payload.extras.openclaw.outbound expected true`);
      }
      if (
        expectedPayload.extras?.openclaw?.source &&
        String(outboundMeta?.source ?? '') !== expectedPayload.extras.openclaw.source
      ) {
        fail(`channel_expected_payload.extras.openclaw.source expected "${expectedPayload.extras.openclaw.source}"`);
      }
    }

    if (assertions.message_list_distinct_ids && visibleUser && visibleReply) {
      if (String(visibleUser.id) === String(visibleReply.id)) {
        fail(`user/reply message ids are not distinct (${visibleUser.id})`);
      }
    }

    if (assertions.message_list_expected_reply_count_by_title !== undefined) {
      const replyCount = titled.filter((m) => {
        const text = String(m.message ?? '').trim();
        if (!text) return false;
        if (expectedUserText && text === expectedUserText.trim()) return false;
        return assistantTexts.some((assistant) => assistant === text);
      }).length;
      if (replyCount !== assertions.message_list_expected_reply_count_by_title) {
        fail(`reply count for title "${title}" expected ${assertions.message_list_expected_reply_count_by_title}, got ${replyCount}`);
      }
    }

    if (visibleUser) {
      const inboundExpected = (item.tc as StandardTestCase & { sdk_inbound?: SdkMessageShape }).sdk_inbound;
      if (inboundExpected) {
        const materialized = materializeActualInboundUnified(
          item.ctx.accountId,
          item.ctx.peerId,
          visibleUser,
        );
        const normalizedExpected: SdkMessageShape = {
          ...inboundExpected,
          source: {
            ...inboundExpected.source,
            accountId: interpolateValue(inboundExpected.source.accountId, item.tc, item.ctx),
            userId: interpolateValue(inboundExpected.source.userId, item.tc, item.ctx),
          },
          text: interpolateValue(inboundExpected.text, item.tc, item.ctx),
        };
        for (const message of assertUnifiedShape(normalizedExpected, materialized, `${item.tc.id}.sdk_inbound`)) {
          fail(message);
        }
      }
    }

    if (visibleReply && withSdk.sdk_expected_reply) {
      const expectedReply: SdkExpectedReplyShape = {
        ...withSdk.sdk_expected_reply,
        source: {
          ...withSdk.sdk_expected_reply.source,
          accountId: interpolateValue(withSdk.sdk_expected_reply.source.accountId, item.tc, item.ctx),
          userId: interpolateValue(withSdk.sdk_expected_reply.source.userId, item.tc, item.ctx),
        },
      };
      const materialized = materializeActualOutboundUnified(
        item.ctx.accountId,
        item.ctx.peerId,
        expectedReply.contentType,
        visibleReply,
      );
      for (const message of assertUnifiedShape(expectedReply, materialized, `${item.tc.id}.sdk_expected_reply`)) {
        fail(message);
      }
    }
  }

  return failures;
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
  if (!process.env.OPENCLAW_TEST_VISIBLE) {
    process.env.OPENCLAW_TEST_VISIBLE = '1';
  }

  const dataset = await loadDataset(datasetPath);
  validateSdkShape(dataset);

  console.log('');
  console.log('  ℹ️  Gotify 专用测试集默认开启 OPENCLAW_TEST_VISIBLE=1，保留 Gotify 消息用于验证“新回复消息”。');
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
  if (finalExit === 0) {
    const assertionFailures = await verifyGotifyAssertions();
    if (assertionFailures > 0) {
      finalExit = 1;
    }
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

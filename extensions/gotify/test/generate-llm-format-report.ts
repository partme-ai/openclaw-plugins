import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildMessage, type UnifiedMessage } from '@partme.ai/openclaw-message-sdk';
import { interpolate, loadDataset, type StandardTestCase, type TestContext } from '../../../testing/scripts/run-standard-tests.js';
import { resolveGotifyAccount } from '../src/config.js';
import { deleteAllMessages, getMessages, sendGotifyMessage, type GotifyPagedMessages } from '../src/transport/gotify-api.js';
import { mapGotifyStreamToUnified } from '../src/routing/message-mapper.js';
import { fetchChatHistory, extractMessageText, waitForUserTranscript } from './gateway-transcript.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATASET_PATH = resolve(__dirname, './gotify-standard-dataset.yaml');
const REPORT_DIR = resolve(__dirname, './reports');
const JSON_REPORT = resolve(REPORT_DIR, 'gotify-llm-format-report.json');
const MD_REPORT = resolve(REPORT_DIR, 'gotify-llm-format-report.md');

type DatasetCase = StandardTestCase & {
  sdk_inbound?: Record<string, unknown>;
  sdk_inbound_sequence?: Array<Record<string, unknown>>;
  sdk_expected_reply?: Record<string, unknown>;
  channel_expected_payload?: Record<string, unknown>;
};

type GotifyMessageRecord = NonNullable<GotifyPagedMessages['messages']>[number];

type CaseRunSample = {
  turn: number;
  title: string;
  sentAt: number;
  visibleUserRaw: GotifyMessageRecord | null;
  visibleReplyRaw: GotifyMessageRecord | null;
  inboundUnified: UnifiedMessage | null;
  outboundUnified: UnifiedMessage | null;
  transcriptUserText: string | null;
  transcriptAssistantText: string | null;
};

type CaseReport = {
  id: string;
  name: string;
  status: 'pass' | 'fail';
  error?: string;
  sessionKey: string;
  inputType: string;
  replyAssertions?: unknown;
  sdkInboundExpected?: unknown;
  sdkExpectedReply?: unknown;
  channelExpectedPayload?: unknown;
  samples: CaseRunSample[];
};

function buildAccount() {
  const accountId = process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default';
  const gotifyUrl = process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080';
  const appToken = process.env.GOTIFY_APP_TOKEN ?? '';
  const clientToken = process.env.GOTIFY_CLIENT_TOKEN ?? '';
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          ...(accountId === 'default'
            ? {
                serverUrl: gotifyUrl,
                appToken,
                clientToken,
              }
            : {
                accounts: {
                  [accountId]: {
                    serverUrl: gotifyUrl,
                    appToken,
                    clientToken,
                  },
                },
              }),
        },
      },
    },
    accountId,
  );
}

function buildSenderAccount() {
  const account = buildAccount();
  const senderToken = process.env.GOTIFY_SENDER_APP_TOKEN ?? process.env.GOTIFY_APP_TOKEN ?? '';
  return {
    ...account,
    appToken: senderToken,
    configured: Boolean(account.serverUrl && senderToken),
  };
}

function buildCtx(caseId: string): TestContext {
  const correlationId = Math.random().toString(36).slice(2, 10);
  return {
    correlationId,
    channel: 'gotify',
    accountId: process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default',
    peerId: process.env.OPENCLAW_TEST_PEER_ID ?? 'default',
    agentId: process.env.OPENCLAW_TEST_AGENT_ID ?? 'main',
    caseId,
    datasetPath: DATASET_PATH,
    vars: {
      CORRELATION_ID: correlationId,
      CHANNEL: 'gotify',
      ACCOUNT_ID: process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default',
      PEER_ID: process.env.OPENCLAW_TEST_PEER_ID ?? 'default',
      AGENT_ID: process.env.OPENCLAW_TEST_AGENT_ID ?? 'main',
      TIMESTAMP: new Date().toISOString(),
      SENDER_ID: process.env.OPENCLAW_TEST_SENDER_ID ?? 'test-sender',
    },
  };
}

function sessionKeyFor(ctx: TestContext): string {
  return `agent:${ctx.agentId}:gotify:${ctx.accountId}:direct:${ctx.peerId}`;
}

function findVisibleReply(
  messages: GotifyMessageRecord[],
  title: string,
  userText: string,
  sinceMs: number,
): GotifyMessageRecord | null {
  const titled = messages.filter((m) => String(m.title ?? '') === title);
  const recent = titled.filter((m) => {
    const ts = Date.parse(typeof m.date === 'string' ? m.date : '');
    return !Number.isFinite(ts) || ts >= sinceMs - 2_000;
  });
  for (const message of recent) {
    const text = String(message.message ?? '').trim();
    if (!text || text === userText.trim()) continue;
    return message;
  }
  return null;
}

function materializeOutboundUnified(
  ctx: TestContext,
  expectedContentType: 'text' | 'markdown' | 'mixed',
  reply: GotifyMessageRecord,
): UnifiedMessage {
  const text = String(reply.message ?? '');
  const metadata = {
    gotifyId: reply.id,
    gotifyAppId: reply.appid,
    title: reply.title,
    priority: reply.priority,
    extras: reply.extras,
    date: reply.date,
  };

  if (expectedContentType === 'markdown') {
    const built = buildMessage({
      channel: 'gotify',
      accountId: ctx.accountId,
      userId: ctx.peerId,
      agentId: ctx.agentId,
      markdown: text,
      chatType: 'direct',
      direction: 'outbound',
      metadata,
    });
    return { ...built, text, markdown: text, contentType: 'markdown' };
  }

  const built = buildMessage({
    channel: 'gotify',
    accountId: ctx.accountId,
    userId: ctx.peerId,
    agentId: ctx.agentId,
    text,
    chatType: 'direct',
    direction: 'outbound',
    metadata,
  });
  return { ...built, contentType: expectedContentType };
}

async function runSingleTurn(
  tc: DatasetCase,
  ctx: TestContext,
  turn: number,
  title: string,
  message: string,
): Promise<CaseRunSample> {
  const account = buildAccount();
  const senderAccount = buildSenderAccount();

  const sent = await sendGotifyMessage(senderAccount, {
    message,
    title,
    priority: 5,
  });
  const sentAt = Date.now();

  const sessionKey = sessionKeyFor(ctx);
  const transcriptHit = await waitForUserTranscript({
    sessionKey,
    sentText: message,
    sinceMs: sentAt - 2_000,
    timeoutMs: Number(process.env.OPENCLAW_UI_GATE_TIMEOUT_MS ?? 45_000),
    pollMs: Number(process.env.OPENCLAW_TEST_POLL_MS ?? 250),
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
  });

  const deadline = Date.now() + Number(process.env.OPENCLAW_REPLY_WAIT_TIMEOUT_MS ?? 90_000);
  let visibleReply: GotifyMessageRecord | null = null;
  while (Date.now() < deadline) {
    const poll = await getMessages(account, { limit: 30 });
    visibleReply = findVisibleReply(
      poll.messages,
      title,
      message,
      sentAt,
    );
    if (visibleReply) break;
    await new Promise((r) => setTimeout(r, Number(process.env.OPENCLAW_TEST_POLL_MS ?? 250)));
  }

  const visibleMessages = await getMessages(account, { limit: 30 });
  const visibleUser =
    visibleMessages.messages.find(
      (m) => String(m.title ?? '') === title && String(m.message ?? '').trim() === message.trim(),
    ) ?? null;

  const inboundUnified = visibleUser
    ? mapGotifyStreamToUnified({
        accountId: ctx.accountId,
        peerId: ctx.peerId,
        agentId: ctx.agentId,
        message: visibleUser,
      })
    : null;

  const expectedContentType = (tc.sdk_expected_reply?.contentType as 'text' | 'markdown' | 'mixed' | undefined) ?? 'text';
  const outboundUnified = visibleReply
    ? materializeOutboundUnified(ctx, expectedContentType, visibleReply)
    : null;

  const transcript = await fetchChatHistory({
    sessionKey,
    limit: 50,
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN,
  });
  const recentMessages = transcript.messages.filter((m) => {
    const ts = m.timestamp ?? 0;
    return !ts || ts >= sentAt - 2_000;
  });
  const assistantText =
    recentMessages
      .filter((m) => m.role === 'assistant')
      .map((m) => extractMessageText(m))
      .filter(Boolean)
      .at(-1) ?? null;

  return {
    turn,
    title,
    sentAt,
    visibleUserRaw: visibleUser,
    visibleReplyRaw: visibleReply,
    inboundUnified,
    outboundUnified,
    transcriptUserText: transcriptHit.userText,
    transcriptAssistantText: assistantText,
  };
}

async function runCase(tc: DatasetCase): Promise<CaseReport> {
  const ctx = buildCtx(tc.id);
  const title = tc.input.title ?? `gotify-${tc.id.toLowerCase()}`;
  const report: CaseReport = {
    id: tc.id,
    name: tc.name,
    status: 'pass',
    sessionKey: sessionKeyFor(ctx),
    inputType: tc.input.type,
    replyAssertions: tc.reply_assertions,
    sdkInboundExpected: tc.sdk_inbound ?? tc.sdk_inbound_sequence,
    sdkExpectedReply: tc.sdk_expected_reply,
    channelExpectedPayload: tc.channel_expected_payload,
    samples: [],
  };

  try {
    await deleteAllMessages(buildAccount());
    if (tc.input.type === 'multi_turn' && tc.input.turns?.length) {
      let turnIndex = 1;
      for (const turn of tc.input.turns) {
        const message = interpolate(turn.message, ctx, tc.input);
        const sample = await runSingleTurn(tc, ctx, turnIndex, title, message);
        report.samples.push(sample);
        turnIndex += 1;
      }
    } else {
      const message = interpolate(tc.input.message ?? '', ctx, tc.input);
      const sample = await runSingleTurn(tc, ctx, 1, title, message);
      report.samples.push(sample);
    }
    if (report.samples.some((s) => !s.visibleReplyRaw || !s.outboundUnified || !s.inboundUnified)) {
      report.status = 'fail';
      report.error = 'missing visible reply or unified samples';
    }
  } catch (error) {
    report.status = 'fail';
    report.error = error instanceof Error ? error.message : String(error);
  }

  return report;
}

function toMarkdown(reports: CaseReport[]): string {
  const lines: string[] = [];
  lines.push('# Gotify LLM Format Report');
  lines.push('');
  lines.push(`Generated at: ${new Date().toISOString()}`);
  lines.push('');

  for (const report of reports) {
    lines.push(`## ${report.id} ${report.name}`);
    lines.push('');
    lines.push(`- status: ${report.status}`);
    lines.push(`- sessionKey: \`${report.sessionKey}\``);
    lines.push(`- inputType: \`${report.inputType}\``);
    if (report.error) {
      lines.push(`- error: ${report.error}`);
    }
    lines.push('');
    lines.push('### expected sdk_inbound');
    lines.push('```json');
    lines.push(JSON.stringify(report.sdkInboundExpected, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('### expected sdk_expected_reply');
    lines.push('```json');
    lines.push(JSON.stringify(report.sdkExpectedReply, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('### expected channel_expected_payload');
    lines.push('```json');
    lines.push(JSON.stringify(report.channelExpectedPayload, null, 2));
    lines.push('```');
    lines.push('');
    for (const sample of report.samples) {
      lines.push(`### actual turn ${sample.turn}`);
      lines.push('');
      lines.push('#### actual inbound UnifiedMessage');
      lines.push('```json');
      lines.push(JSON.stringify(sample.inboundUnified, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('#### actual outbound UnifiedMessage');
      lines.push('```json');
      lines.push(JSON.stringify(sample.outboundUnified, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('#### actual Gotify user raw');
      lines.push('```json');
      lines.push(JSON.stringify(sample.visibleUserRaw, null, 2));
      lines.push('```');
      lines.push('');
      lines.push('#### actual Gotify reply raw');
      lines.push('```json');
      lines.push(JSON.stringify(sample.visibleReplyRaw, null, 2));
      lines.push('```');
      lines.push('');
      lines.push(`#### transcript user text\n\n${sample.transcriptUserText ?? ''}`);
      lines.push('');
      lines.push(`#### transcript assistant text\n\n${sample.transcriptAssistantText ?? ''}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const dataset = await loadDataset(DATASET_PATH);
  const cases = dataset.test_cases.filter((tc) => /^Q\d{2}$/.test(tc.id)) as DatasetCase[];
  const reports: CaseReport[] = [];

  for (const tc of cases) {
    console.log(`Running ${tc.id} ${tc.name}...`);
    const report = await runCase(tc);
    reports.push(report);
    console.log(`  -> ${report.status}`);
    if (report.error) {
      console.log(`  -> ${report.error}`);
    }
  }

  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(JSON_REPORT, JSON.stringify(reports, null, 2), 'utf8');
  await writeFile(MD_REPORT, toMarkdown(reports), 'utf8');

  console.log(`JSON report: ${JSON_REPORT}`);
  console.log(`Markdown report: ${MD_REPORT}`);

  if (reports.some((r) => r.status !== 'pass')) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

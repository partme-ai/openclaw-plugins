/**
 * Gotify 标准测试 ChannelAdapter
 *
 * 将 OpenClaw 共享 test-dataset.yaml 用例映射到 Gotify REST 发送 + 消息轮询。
 * 入站模拟：e2e-user APP token POST /message；轮询：CLIENT token GET /message。
 * 出站回环标记由插件 inbound 过滤；轮询侧接受 Agent 新回复。
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  ChannelAdapter,
  ReplyResult,
  SendResult,
  StandardTestInput,
  TestContext,
  WaitOptions,
} from '../../../testing/scripts/run-standard-tests.js';
import {
  deleteMessage,
  getMessages,
  healthCheck,
  runGotifyDoctor,
  sendGotifyMessage,
} from '../src/gotify-api.js';
import { isGotifyTestVisibleMode } from './test-ui-hint.js';
import { resolveGotifyAccount } from '../src/config.js';
import type { ResolvedGotifyAccount } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const CAPABILITIES_PATH = join(REPO_ROOT, 'testing/capabilities.gotify.yaml');
const FIXTURES_ROOT = join(REPO_ROOT, 'testing/fixtures');

const GOTIFY_URL = process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080';
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'http://localhost:18789';
/** 消费即删下回复在服务端停留极短，默认 250ms 轮询以免错过 Agent 回复。 */
const DEFAULT_POLL_INTERVAL_MS = Number(process.env.OPENCLAW_TEST_POLL_MS ?? 250);

/** 从 capabilities.gotify.yaml 加载布尔能力矩阵。 */
async function loadCapabilities(): Promise<Record<string, boolean>> {
  try {
    const yaml = await import('yaml');
    const raw = readFileSync(CAPABILITIES_PATH, 'utf8');
    const doc = yaml.parse(raw) as { capabilities?: Record<string, boolean> };
    return doc.capabilities ?? {};
  } catch {
    return {
      supports_text: true,
      supports_markdown: true,
      supports_code_blocks: true,
      supports_ws_or_push: true,
      supports_health_endpoint: true,
      supports_dm_policy: true,
      supports_multi_account: true,
      supports_skill_tools: true,
      supports_rate_limit_probe: true,
      supports_concurrent_inbound: true,
      supports_session_label: true,
    };
  }
}

/** 由环境变量构建已解析 Gotify 账号。 */
function buildAccount(): ResolvedGotifyAccount {
  const appToken = process.env.GOTIFY_APP_TOKEN ?? '';
  const clientToken = process.env.GOTIFY_CLIENT_TOKEN ?? '';
  if (!appToken || !clientToken) {
    throw new Error(
      'GOTIFY_APP_TOKEN and GOTIFY_CLIENT_TOKEN are required for standard tests'
    );
  }
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          serverUrl: GOTIFY_URL,
          appToken,
          clientToken,
        },
      },
    },
    process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default'
  );
}

/** 解析 fixture ref 为绝对路径。 */
function resolveFixturePath(ref: string): string | null {
  const rel = ref.startsWith('fixtures/') ? ref : `fixtures/${ref}`;
  const abs = join(FIXTURES_ROOT, rel.replace(/^fixtures\//, ''));
  return existsSync(abs) ? abs : null;
}

/** 构建 Gotify 出站 payload extras（Markdown 等）。 */
function buildSendExtras(input: StandardTestInput): Record<string, unknown> | undefined {
  const contentType =
    typeof input.metadata?.contentType === 'string'
      ? input.metadata.contentType
      : input.type === 'markdown'
        ? 'text/markdown'
        : undefined;
  if (!contentType) return undefined;
  return { 'client::display': { contentType } };
}

/**
 * 轮询 Gotify 消息列表，返回第一条符合条件的新回复及统计信息。
 */
async function pollForReply(
  account: ResolvedGotifyAccount,
  opts: {
    sinceMs: number;
    excludeIds: Set<number>;
    beforeIds: Set<number>;
    deadline: number;
    pollIntervalMs: number;
    sentAt: number;
  }
): Promise<ReplyResult | null> {
  let pollCount = 0;
  const sinceMs = opts.sinceMs - 2000;

  while (Date.now() < opts.deadline) {
    pollCount += 1;
    const poll = await getMessages(account, { limit: 15 });
    for (const msg of poll.messages) {
      const id = Number(msg.id);
      if (opts.excludeIds.has(id)) continue;
      if (opts.beforeIds.has(id)) continue;
      const msgTime = Date.parse(typeof msg.date === 'string' ? msg.date : '');
      if (Number.isFinite(msgTime) && msgTime < sinceMs) continue;

      const receivedAt = Date.now();
      const latencyMs = receivedAt - opts.sentAt;
      return {
        text: typeof msg.message === 'string' ? msg.message : '',
        receivedAt,
        messageId: String(id),
        raw: msg,
        latencyMs,
        pollCount,
        waitDurationMs: receivedAt - opts.sentAt,
      };
    }
    await sleep(opts.pollIntervalMs);
  }
  return null;
}

/**
 * 创建 Gotify 标准测试适配器实例。
 */
export async function createGotifyAdapter(): Promise<ChannelAdapter> {
  const account = buildAccount();
  const capabilities = await loadCapabilities();
  let beforeIds = new Set<number>();

  return {
    channelId: 'gotify',
    capabilities,

    async healthCheck() {
      const h = await healthCheck(account);
      return { ok: h.ok, latencyMs: h.latencyMs };
    },

    async runDoctor() {
      const d = await runGotifyDoctor(account);
      return { ok: d.ok, errors: d.errors };
    },

    async getAccountStatus() {
      try {
        const res = await fetch(`${GATEWAY_URL.replace(/\/+$/, '')}/gotify/status`);
        if (!res.ok) {
          return { running: false, lastError: `gateway status HTTP ${res.status}` };
        }
        const body = (await res.json()) as {
          ok?: boolean;
          data?: {
            accounts?: Array<{
              accountId?: string;
              runtime?: { running?: boolean; lastError?: string | null };
            }>;
          };
        };
        const targetId = process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default';
        const acct =
          body.data?.accounts?.find((a) => a.accountId === targetId) ??
          body.data?.accounts?.[0];
        const runtime = acct?.runtime;
        return {
          running: runtime?.running === true,
          lastError: runtime?.lastError ?? null,
        };
      } catch (err) {
        return {
          running: false,
          lastError: err instanceof Error ? err.message : String(err),
        };
      }
    },

    async send(input: StandardTestInput, ctx: TestContext): Promise<SendResult> {
      const body = input.message ?? '';
      if (body.trim().length === 0) {
        const snap = await getMessages(account, { limit: 20 });
        beforeIds = new Set(snap.messages.map((m) => Number(m.id)));
        return { messageId: `empty-${ctx.correlationId}`, sentAt: Date.now() };
      }

      const snap = await getMessages(account, { limit: 20 });
      beforeIds = new Set(snap.messages.map((m) => Number(m.id)));

      if (input.attachments?.length) {
        const missing = input.attachments.filter((a) => {
          if (a.source !== 'fixture' || !a.ref) return false;
          return resolveFixturePath(a.ref) === null;
        });
        if (missing.length) {
          throw new Error(`fixture missing: ${missing.map((m) => m.ref).join(', ')}`);
        }
      }

      const title =
        input.title ??
        (typeof input.metadata?.test_id === 'string'
          ? `openclaw-std-${input.metadata.test_id}`
          : `openclaw-std-${ctx.caseId}`);

      const payload = {
        message: body,
        title,
        priority: 5,
        extras: buildSendExtras(input),
      };

      const sent = await sendGotifyMessage(account, payload);
      const sentAt = Date.now();
      return { messageId: String(sent.id), sentAt, raw: sent };
    },

    async waitForReply(ctx: TestContext, opts: WaitOptions): Promise<ReplyResult | null> {
      const exclude = new Set(
        [...(opts.excludeMessageIds ?? []), opts.afterMessageId]
          .filter(Boolean)
          .map((id) => Number(id))
          .filter(Number.isFinite)
      );
      const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const waitStart = Date.now();
      const hit = await pollForReply(account, {
        sinceMs: opts.sinceMs,
        excludeIds: exclude,
        beforeIds,
        deadline: waitStart + opts.timeoutMs,
        pollIntervalMs,
        sentAt: opts.sinceMs,
      });
      if (hit) {
        hit.waitDurationMs = Date.now() - waitStart;
        return hit;
      }
      return null;
    },

    async waitForNoReply(
      _ctx: TestContext,
      opts: WaitOptions
    ): Promise<{ pollCount: number; waitDurationMs: number; unexpectedReply?: ReplyResult }> {
      const exclude = new Set(
        [...(opts.excludeMessageIds ?? []), opts.afterMessageId]
          .filter(Boolean)
          .map((id) => Number(id))
          .filter(Number.isFinite)
      );
      const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const waitStart = Date.now();
      const hit = await pollForReply(account, {
        sinceMs: opts.sinceMs,
        excludeIds: exclude,
        beforeIds,
        deadline: waitStart + opts.timeoutMs,
        pollIntervalMs,
        sentAt: opts.sinceMs,
      });
      const waitDurationMs = Date.now() - waitStart;
      if (hit) {
        hit.waitDurationMs = waitDurationMs;
        return { pollCount: hit.pollCount ?? 0, waitDurationMs, unexpectedReply: hit };
      }
      return { pollCount: Math.ceil(waitDurationMs / pollIntervalMs) || 1, waitDurationMs };
    },

    async cleanup(messageIds: string[]): Promise<void> {
      if (isGotifyTestVisibleMode()) {
        return;
      }
      for (const id of messageIds) {
        const num = Number(id);
        if (!Number.isFinite(num)) continue;
        await deleteMessage(account, num).catch(() => undefined);
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

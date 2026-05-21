/**
 * OpenClaw 标准渠道测试 — 通用 Runner 骨架
 *
 * 本文件位于 testing/scripts/，供各插件通过 ChannelAdapter 包装调用。
 * 不包含任何渠道专属 import；插件在 extensions/{channel}/scripts/ 实现适配器。
 *
 * 用法（在插件目录）:
 *   npx tsx ../../../testing/scripts/run-standard-tests.ts
 *   或插件内 thin wrapper import { runStandardTests } from '...'
 *
 * 依赖: Node 22+；可选 `yaml` 包解析 test-dataset.yaml
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// ── 类型定义 ─────────────────────────────────────────────────────────────────

/** 单条测试输入（与 test-dataset.yaml 对齐的子集） */
export type StandardTestInput = {
  type: string;
  message?: string;
  title?: string;
  command?: string;
  args?: string[];
  attachments?: Array<{
    kind: string;
    source: string;
    url?: string;
    ref?: string;
    mime?: string;
  }>;
  turns?: Array<{ message: string; expected_reply_contains_any?: string[]; expected_reply_contains?: string }>;
  template_vars?: Record<string, unknown>;
  duplicate?: { same_message_id: boolean; replay_count: number; interval_ms: number };
  messages?: Array<{ id?: string; message: string }>;
  sample_size?: number;
  message_template?: string;
  metadata?: Record<string, string>;
};

/** L1-RT 专用回复断言（可与 expected.reply_text 并存，runner 合并校验） */
export type ReplyAssertions = {
  contains_any?: string[];
  contains_all?: string[];
  min_length?: number;
  max_length?: number;
  not_contains?: string[];
  matches_regex?: string;
};

/** 期望断言（与 test-dataset.yaml expected 对齐） */
export type StandardTestExpected = {
  reply_received?: boolean;
  expect_wait_timeout?: boolean;
  reply_text?: {
    min_length?: number;
    max_length?: number;
    contains_any?: string[];
    contains_all?: string[];
    matches_regex?: string;
  };
  reply_latency_ms_max?: number | string;
  agent_invoked?: boolean;
  tool_invoked?: boolean;
  inbound_blocked?: boolean;
  echo_loop_count?: number;
  max_agent_invocations?: number;
  agent_invocation_count?: number;
  health_ok?: boolean;
  doctor_ok?: boolean;
  errors_count?: number;
  account_running?: boolean;
  latency_p95_ms_max?: number;
  success_rate_min?: number;
  no_duplicate_replies?: number;
  [key: string]: unknown;
};

/** 数据集单条用例 */
export type StandardTestCase = {
  id: string;
  name: string;
  tier: string;
  category: string;
  automation: 'auto' | 'semi' | 'manual';
  priority: string;
  objective?: string;
  preconditions?: string[];
  required_capabilities?: string[];
  skip_if_missing_capabilities?: string[];
  optional_capabilities?: string[];
  timeout_ms: number;
  /** 显式进入 send → wait → assert 回复路径（默认与 expected.reply_received 一致） */
  wait_for_reply?: boolean;
  /** 仅等待阶段超时（毫秒或 default_sla 占位符） */
  reply_timeout_ms?: number | string;
  /** 与 expected.reply_text 合并的回复内容断言 */
  reply_assertions?: ReplyAssertions;
  /** 故意短超时，期望 runner 以「等待回复超时」FAIL */
  expect_wait_timeout?: boolean;
  /** 记录 sent_at / reply_at / latency_ms / poll_count */
  wait_metrics?: boolean;
  steps?: string[];
  input: StandardTestInput;
  expected: StandardTestExpected;
  failure_signals?: string[];
};

/** 完整数据集 */
export type StandardTestDataset = {
  schema_version: string;
  suite_id: string;
  test_cases: StandardTestCase[];
  default_sla?: Record<string, number>;
  placeholders?: Record<string, string>;
  fixture_refs?: Record<string, string>;
};

/** 发送结果 */
export type SendResult = {
  messageId: string;
  sentAt: number;
  raw?: unknown;
};

/** 回复结果 */
export type ReplyResult = {
  text: string;
  receivedAt: number;
  messageId?: string;
  raw?: unknown;
  media?: Array<{ kind: string; url?: string }>;
  /** 从 sentAt 到收到回复的毫秒数（适配器可选填充） */
  latencyMs?: number;
  /** 轮询次数（含首次查询） */
  pollCount?: number;
  /** 等待阶段总耗时 */
  waitDurationMs?: number;
};

/** waitForReply 扩展返回（与 ReplyResult 同构，字段更全） */
export type WaitForReplyResult = ReplyResult;

/** 运行上下文 */
export type TestContext = {
  correlationId: string;
  channel: string;
  accountId: string;
  peerId: string;
  agentId: string;
  caseId: string;
  datasetPath: string;
  vars: Record<string, string>;
};

export type WaitOptions = {
  timeoutMs: number;
  sinceMs: number;
  /** 发送方消息 ID，轮询时排除 */
  afterMessageId?: string;
  excludeMessageIds?: string[];
  pollIntervalMs?: number;
};

/** 插件必须实现的适配器 */
export interface ChannelAdapter {
  channelId: string;
  capabilities: Record<string, boolean>;
  send(input: StandardTestInput, ctx: TestContext): Promise<SendResult>;
  waitForReply(ctx: TestContext, opts: WaitOptions): Promise<WaitForReplyResult | null>;
  /** 负向：在 timeoutMs 内确认无新回复 */
  waitForNoReply?(
    ctx: TestContext,
    opts: WaitOptions
  ): Promise<{ pollCount: number; waitDurationMs: number; unexpectedReply?: ReplyResult }>;
  healthCheck?(): Promise<{ ok: boolean; latencyMs: number }>;
  runDoctor?(): Promise<{ ok: boolean; errors: string[] }>;
  getAccountStatus?(): Promise<{ running: boolean; lastError: string | null }>;
  cleanup?(messageIds: string[]): Promise<void>;
}

/** Runner 选项 */
export type RunStandardTestsOptions = {
  datasetPath?: string;
  tiers?: string[];
  ids?: string[];
  skipManual?: boolean;
  timeoutMultiplier?: number;
  onCaseStart?: (tc: StandardTestCase) => void;
  onCaseEnd?: (result: TestCaseResult) => void;
  /** 用例结束回调（含上下文，供渠道打印 Control UI 会话指引等） */
  onCaseEndWithContext?: (
    result: TestCaseResult,
    tc: StandardTestCase,
    ctx: TestContext
  ) => void;
};

export type TestCaseResult = {
  id: string;
  name: string;
  tier: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  durationMs: number;
  message?: string;
  automation: string;
  /** send 阶段时间戳（wait_metrics 或 L1-RT） */
  sent_at?: number;
  reply_at?: number;
  latency_ms?: number;
  poll_count?: number;
  wait_duration_ms?: number;
};

// ── YAML 加载（可选依赖）────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DATASET = join(__dirname, '..', 'test-dataset.yaml');

/**
 * 加载 test-dataset.yaml；优先 dynamic import yaml，失败则 try createRequire(cwd)。
 */
async function importYamlParser(): Promise<{ parse: (s: string) => unknown }> {
  try {
    return await import('yaml');
  } catch {
    try {
      const { createRequire } = await import('node:module');
      const req = createRequire(join(process.cwd(), 'package.json'));
      return req('yaml') as { parse: (s: string) => unknown };
    } catch {
      throw new Error(
        'Cannot parse YAML: install `yaml` in your plugin (`pnpm add -D yaml`) or repo root'
      );
    }
  }
}

/**
 * 加载 test-dataset.yaml；优先 dynamic import yaml，失败则提示安装。
 */
export async function loadDataset(path?: string): Promise<StandardTestDataset> {
  const resolved = resolve(path ?? process.env.OPENCLAW_TEST_DATASET ?? DEFAULT_DATASET);
  if (!existsSync(resolved)) {
    throw new Error(`Dataset not found: ${resolved}`);
  }
  const raw = readFileSync(resolved, 'utf8');
  try {
    const yaml = await importYamlParser();
    return yaml.parse(raw) as StandardTestDataset;
  } catch (err) {
    if (err instanceof Error && err.message.includes('Cannot parse YAML')) throw err;
    throw new Error(
      'Cannot parse YAML: install `yaml` in your plugin or run from repo with `npm install yaml`'
    );
  }
}

// ── 占位符与模板 ─────────────────────────────────────────────────────────────

/**
 * 替换消息中的 {PLACEHOLDER} 与 {{LONG_TEXT_2KB}} 类模板变量。
 */
export function interpolate(template: string, ctx: TestContext, input: StandardTestInput): string {
  let out = template;
  for (const [k, v] of Object.entries(ctx.vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  if (input.template_vars?.LONG_TEXT_2KB) {
    const spec = input.template_vars.LONG_TEXT_2KB as { generator: string; base: string; count: number };
    if (spec.generator === 'repeat') {
      const long = spec.base.repeat(spec.count);
      out = out.split('{{LONG_TEXT_2KB}}').join(long);
    }
  }
  return out;
}

/**
 * 解析 expected 中的 SLA 引用，如 "{default_sla.plain_text_reply_max_ms}"。
 */
export function resolveExpectedNumber(
  value: number | string | undefined,
  sla: Record<string, number>
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number') return value;
  const m = /^\{default_sla\.(\w+)\}$/.exec(value);
  if (m) return sla[m[1]!];
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// ── 断言 ─────────────────────────────────────────────────────────────────────

/**
 * 对单条回复做 expected.reply_text 断言。
 */
/**
 * 合并 expected.reply_text 与用例级 reply_assertions，对回复正文断言。
 */
export function assertReplyText(
  text: string,
  expected?: StandardTestExpected['reply_text'],
  replyAssertions?: ReplyAssertions
): string | null {
  const merged: ReplyAssertions = {
    min_length: replyAssertions?.min_length ?? expected?.min_length,
    max_length: replyAssertions?.max_length ?? expected?.max_length,
    contains_any: replyAssertions?.contains_any ?? expected?.contains_any,
    contains_all: replyAssertions?.contains_all ?? expected?.contains_all,
    matches_regex: replyAssertions?.matches_regex ?? expected?.matches_regex,
    not_contains: replyAssertions?.not_contains,
  };
  if (!merged.min_length && !merged.max_length && !merged.contains_any?.length && !merged.contains_all?.length && !merged.matches_regex && !merged.not_contains?.length) {
    return null;
  }
  if (merged.min_length !== undefined && text.length < merged.min_length) {
    return `reply length ${text.length} < min ${merged.min_length}`;
  }
  if (merged.max_length !== undefined && text.length > merged.max_length) {
    return `reply length ${text.length} > max ${merged.max_length}`;
  }
  if (merged.contains_any?.length) {
    const hit = merged.contains_any.some((s) => text.includes(s));
    if (!hit) return `reply missing any of: ${merged.contains_any.join(', ')}`;
  }
  if (merged.contains_all?.length) {
    const missing = merged.contains_all.filter((s) => !text.includes(s));
    if (missing.length) return `reply missing: ${missing.join(', ')}`;
  }
  if (merged.not_contains?.length) {
    const hit = merged.not_contains.filter((s) => text.includes(s));
    if (hit.length) return `reply must not contain: ${hit.join(', ')}`;
  }
  if (merged.matches_regex) {
    const re = new RegExp(merged.matches_regex);
    if (!re.test(text.trim())) return `reply does not match /${merged.matches_regex}/`;
  }
  return null;
}

/**
 * 解析用例级 reply_timeout_ms（支持 default_sla 占位符）。
 */
export function resolveReplyTimeoutMs(
  tc: StandardTestCase,
  caseTimeoutMs: number,
  sla: Record<string, number>
): number {
  const raw = tc.reply_timeout_ms;
  if (raw === undefined) return caseTimeoutMs;
  return resolveExpectedNumber(raw, sla) ?? caseTimeoutMs;
}

/**
 * 是否进入显式 wait-for-reply 路径。
 */
export function shouldWaitForReply(tc: StandardTestCase): boolean {
  if (tc.wait_for_reply !== undefined) return tc.wait_for_reply;
  return tc.expected.reply_received !== false;
}

/**
 * 是否期望等待超时（L1-RT-03 负向）。
 */
export function expectsWaitTimeout(tc: StandardTestCase): boolean {
  return tc.expect_wait_timeout === true || tc.expected.expect_wait_timeout === true;
}

export type SendWaitReplyMetrics = {
  sentAt: number;
  sentMessageId?: string;
  replyAt?: number;
  latencyMs?: number;
  pollCount?: number;
  waitDurationMs?: number;
};

/**
 * 三阶段：send → wait → assert；打印阶段日志并返回指标。
 */
export async function executeSendWaitReply(
  adapter: ChannelAdapter,
  tc: StandardTestCase,
  ctx: TestContext,
  input: StandardTestInput,
  opts: {
    caseTimeoutMs: number;
    sla: Record<string, number>;
    log?: (line: string) => void;
  }
): Promise<
  | { ok: true; reply: ReplyResult; metrics: SendWaitReplyMetrics }
  | { ok: false; message: string; metrics: SendWaitReplyMetrics; timedOut?: boolean }
> {
  const log = opts.log ?? ((line: string) => console.log(`    ${line}`));
  const waitForReply = shouldWaitForReply(tc);
  const waitTimeoutMs = resolveReplyTimeoutMs(tc, opts.caseTimeoutMs, opts.sla);
  const pollIntervalMs = Number(process.env.OPENCLAW_TEST_POLL_MS ?? 250);

  log(`[send] case=${tc.id} type=${input.type}`);
  const sent = await adapter.send(input, ctx);
  log(`[send] messageId=${sent.messageId} sent_at=${sent.sentAt}`);

  const metrics: SendWaitReplyMetrics = { sentAt: sent.sentAt, sentMessageId: sent.messageId };
  const excludeIds = [sent.messageId];
  const waitOpts: WaitOptions = {
    timeoutMs: waitTimeoutMs,
    sinceMs: sent.sentAt,
    afterMessageId: sent.messageId,
    excludeMessageIds: excludeIds,
    pollIntervalMs,
  };

  if (!waitForReply) {
    log(`[wait] skip (wait_for_reply=false), probe ${Math.min(waitTimeoutMs, 5000)}ms`);
    const probeMs = Math.min(waitTimeoutMs, 5000);
    const waitStart = Date.now();
    if (adapter.waitForNoReply) {
      const no = await adapter.waitForNoReply(ctx, { ...waitOpts, timeoutMs: probeMs });
      metrics.waitDurationMs = no.waitDurationMs;
      metrics.pollCount = no.pollCount;
      if (no.unexpectedReply) {
        metrics.replyAt = no.unexpectedReply.receivedAt;
        metrics.latencyMs =
          no.unexpectedReply.latencyMs ?? no.unexpectedReply.receivedAt - sent.sentAt;
        return { ok: false, message: 'unexpected reply received', metrics };
      }
    } else {
      const surprise = await adapter.waitForReply(ctx, { ...waitOpts, timeoutMs: probeMs });
      metrics.waitDurationMs = Date.now() - waitStart;
      metrics.pollCount = surprise?.pollCount;
      if (surprise && tc.expected.reply_received === false) {
        metrics.replyAt = surprise.receivedAt;
        metrics.latencyMs = surprise.latencyMs ?? surprise.receivedAt - sent.sentAt;
        return { ok: false, message: 'unexpected reply received', metrics };
      }
    }
    log(`[assert] no reply expected — ok`);
    return { ok: true, reply: { text: '', receivedAt: Date.now() }, metrics };
  }

  log(`[wait] timeout=${waitTimeoutMs}ms poll_interval=${pollIntervalMs}ms`);
  const waitStart = Date.now();
  const reply = await adapter.waitForReply(ctx, waitOpts);
  const waitedMs = Date.now() - waitStart;
  metrics.waitDurationMs = reply?.waitDurationMs ?? waitedMs;
  metrics.pollCount = reply?.pollCount;

  if (!reply) {
    log(`[wait] 等待回复超时 (waited ${waitedMs}ms, polls=${metrics.pollCount ?? '?'})`);
    if (expectsWaitTimeout(tc)) {
      return {
        ok: true,
        reply: { text: '', receivedAt: Date.now() },
        metrics,
      };
    }
    return {
      ok: false,
      message: `等待回复超时 (waited ${waitedMs}ms, polls=${metrics.pollCount ?? 0})`,
      metrics,
      timedOut: true,
    };
  }

  metrics.replyAt = reply.receivedAt;
  metrics.latencyMs = reply.latencyMs ?? reply.receivedAt - sent.sentAt;
  log(
    `[wait] reply_at=${reply.receivedAt} latency_ms=${metrics.latencyMs} polls=${metrics.pollCount ?? '?'}`
  );

  const maxLat = resolveExpectedNumber(
    tc.expected.reply_latency_ms_max as number | string | undefined,
    opts.sla
  );
  if (maxLat !== undefined && metrics.latencyMs !== undefined && metrics.latencyMs > maxLat) {
    return {
      ok: false,
      message: `latency ${metrics.latencyMs}ms > ${maxLat}ms`,
      metrics,
    };
  }

  const textErr = assertReplyText(reply.text, tc.expected.reply_text, tc.reply_assertions);
  if (textErr) {
    log(`[assert] ${textErr}`);
    return { ok: false, message: textErr, metrics };
  }

  log(`[assert] reply ok (${reply.text.length} chars)`);
  return { ok: true, reply, metrics };
}

// ── Skip 逻辑 ────────────────────────────────────────────────────────────────

/**
 * 根据 adapter.capabilities 判断是否跳过用例。
 */
export function shouldSkipCase(tc: StandardTestCase, adapter: ChannelAdapter): string | null {
  const caps = adapter.capabilities;
  const required = tc.required_capabilities ?? [];
  for (const r of required) {
    if (!caps[r]) return `missing capability: ${r}`;
  }
  const skipIf = tc.skip_if_missing_capabilities ?? [];
  for (const s of skipIf) {
    if (!caps[s]) return `skip_if_missing: ${s}`;
  }
  return null;
}

// ── 单用例执行 ───────────────────────────────────────────────────────────────

/**
 * 执行单个标准用例（L0 health / 默认 send+wait 路径）。
 */
export type RunOneCaseOutcome = {
  result: TestCaseResult;
  ctx: TestContext;
};

export async function runOneCase(
  adapter: ChannelAdapter,
  tc: StandardTestCase,
  dataset: StandardTestDataset,
  opts: RunStandardTestsOptions
): Promise<RunOneCaseOutcome> {
  const start = Date.now();
  const multiplier = opts.timeoutMultiplier ?? Number(process.env.OPENCLAW_TEST_TIMEOUT_MULTIPLIER ?? 1);
  const timeoutMs = tc.timeout_ms * multiplier;

  const ctx: TestContext = {
    correlationId: randomUUID().slice(0, 8),
    channel: adapter.channelId,
    accountId: process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default',
    peerId: process.env.OPENCLAW_TEST_PEER_ID ?? 'default',
    agentId: process.env.OPENCLAW_TEST_AGENT_ID ?? 'main',
    caseId: tc.id,
    datasetPath: opts.datasetPath ?? DEFAULT_DATASET,
    vars: {
      CORRELATION_ID: randomUUID().slice(0, 8),
      CHANNEL: adapter.channelId,
      ACCOUNT_ID: process.env.OPENCLAW_TEST_ACCOUNT_ID ?? 'default',
      PEER_ID: process.env.OPENCLAW_TEST_PEER_ID ?? 'default',
      AGENT_ID: process.env.OPENCLAW_TEST_AGENT_ID ?? 'main',
      TIMESTAMP: new Date().toISOString(),
      SENDER_ID: process.env.OPENCLAW_TEST_SENDER_ID ?? 'test-sender',
    },
  };
  ctx.vars.CORRELATION_ID = ctx.correlationId;

  const skipReason = shouldSkipCase(tc, adapter);
  if (skipReason) {
    return {
      ctx,
      result: {
        id: tc.id,
        name: tc.name,
        tier: tc.tier,
        status: 'skip',
        durationMs: 0,
        message: skipReason,
        automation: tc.automation,
      },
    };
  }

  if (opts.skipManual !== false && tc.automation === 'manual') {
    return {
      ctx,
      result: {
        id: tc.id,
        name: tc.name,
        tier: tc.tier,
        status: 'skip',
        durationMs: 0,
        message: 'manual case',
        automation: tc.automation,
      },
    };
  }

  try {
    // L0 专用分支
    if (tc.tier === 'L0') {
      if (tc.id === 'L0-01' && adapter.healthCheck) {
        const h = await adapter.healthCheck();
        const maxLat = resolveExpectedNumber(
          tc.expected.latency_ms_max as number | string | undefined,
          dataset.default_sla ?? {}
        );
        if (!h.ok) return outcome(ctx, fail(tc, start, 'health not ok'));
        if (maxLat !== undefined && h.latencyMs > maxLat) {
          return outcome(ctx, fail(tc, start, `latency ${h.latencyMs}ms > ${maxLat}ms`));
        }
        return outcome(ctx, pass(tc, start));
      }
      if (tc.id === 'L0-02' && adapter.runDoctor) {
        const d = await adapter.runDoctor();
        if (!d.ok || (tc.expected.errors_count === 0 && d.errors.length > 0)) {
          return outcome(ctx, fail(tc, start, d.errors.join('; ')));
        }
        return outcome(ctx, pass(tc, start));
      }
      if (tc.id === 'L0-03' && adapter.getAccountStatus) {
        const s = await adapter.getAccountStatus();
        if (!s.running || s.lastError) {
          return outcome(ctx, fail(tc, start, s.lastError ?? 'not running'));
        }
        return outcome(ctx, pass(tc, start));
      }
      return outcome(ctx, skip(tc, start, 'L0 adapter method not implemented'));
    }

    const sla = dataset.default_sla ?? {};

    // L20 采样：多次 send → wait → 统计 p95
    if (tc.input.type === 'benchmark' && tc.input.sample_size) {
      const n = tc.input.sample_size;
      const template = tc.input.message_template ?? '【{CORRELATION_ID}】ping';
      const latencies: number[] = [];
      let successes = 0;
      for (let i = 0; i < n; i++) {
        ctx.vars.N = String(i + 1);
        const msg = interpolate(template.replace('{N}', String(i + 1)), ctx, tc.input);
        const benchInput = { ...tc.input, type: 'text' as const, message: msg };
        const flow = await executeSendWaitReply(adapter, tc, ctx, benchInput, {
          caseTimeoutMs: timeoutMs,
          sla,
        });
        if (flow.ok && flow.metrics.latencyMs !== undefined) {
          latencies.push(flow.metrics.latencyMs);
          successes += 1;
        }
      }
      const rate = successes / n;
      const minRate = tc.expected.success_rate_min ?? 0;
      if (rate < minRate) {
        return outcome(
          ctx,
          fail(tc, start, `success rate ${(rate * 100).toFixed(0)}% < ${(minRate * 100).toFixed(0)}%`)
        );
      }
      if (latencies.length > 0) {
        latencies.sort((a, b) => a - b);
        const p95Idx = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
        const p95 = latencies[p95Idx]!;
        const maxP95 = tc.expected.latency_p95_ms_max;
        if (maxP95 !== undefined && p95 > maxP95) {
          return outcome(ctx, fail(tc, start, `p95 latency ${p95}ms > ${maxP95}ms`));
        }
        console.log(`    [benchmark] n=${n} success=${successes} p95=${p95}ms latencies=${latencies.join(',')}`);
      }
      return outcome(ctx, passWithMetrics(tc, start, {}));
    }

    // 多轮
    if (tc.input.type === 'multi_turn' && tc.input.turns?.length) {
      for (const turn of tc.input.turns) {
        const msg = interpolate(turn.message, ctx, tc.input);
        const turnTc = { ...tc, input: { ...tc.input, type: 'text' as const, message: msg } };
        const flow = await executeSendWaitReply(adapter, turnTc, ctx, turnTc.input, {
          caseTimeoutMs: timeoutMs,
          sla,
        });
        if (!flow.ok) return outcome(ctx, fail(tc, start, flow.message));
        const reply = flow.reply;
        if (turn.expected_reply_contains && !reply.text.includes(interpolate(turn.expected_reply_contains, ctx, tc.input))) {
          return outcome(ctx, fail(tc, start, `expected contains: ${turn.expected_reply_contains}`));
        }
        if (turn.expected_reply_contains_any) {
          const ok = turn.expected_reply_contains_any.some((s) => reply.text.includes(s));
          if (!ok) return outcome(ctx, fail(tc, start, 'expected_reply_contains_any failed'));
        }
      }
      return outcome(ctx, pass(tc, start));
    }

    // 默认：单条 send → wait → assert
    const input = { ...tc.input };
    if (input.message) input.message = interpolate(input.message, ctx, input);

    const flow = await executeSendWaitReply(adapter, tc, ctx, input, {
      caseTimeoutMs: timeoutMs,
      sla,
    });

    if (expectsWaitTimeout(tc)) {
      if (!flow.ok && flow.timedOut) {
        return outcome(
          ctx,
          passWithMetrics(tc, start, {
            sent_at: flow.metrics.sentAt,
            wait_duration_ms: flow.metrics.waitDurationMs,
            poll_count: flow.metrics.pollCount,
          })
        );
      }
      if (flow.ok) {
        return outcome(
          ctx,
          fail(tc, start, 'expected wait timeout but received reply within short window')
        );
      }
      return outcome(ctx, fail(tc, start, flow.message));
    }

    if (!flow.ok) {
      return outcome(
        ctx,
        failWithMetrics(tc, start, flow.message, {
          sent_at: flow.metrics.sentAt,
          reply_at: flow.metrics.replyAt,
          latency_ms: flow.metrics.latencyMs,
          poll_count: flow.metrics.pollCount,
          wait_duration_ms: flow.metrics.waitDurationMs,
        })
      );
    }

    const reply = flow.reply;
    if (adapter.cleanup) {
      const ids = [flow.metrics.sentMessageId, reply.messageId].filter(Boolean) as string[];
      if (ids.length) await adapter.cleanup(ids);
    }

    const metricsFields = tc.wait_metrics
      ? {
          sent_at: flow.metrics.sentAt,
          reply_at: flow.metrics.replyAt,
          latency_ms: flow.metrics.latencyMs,
          poll_count: flow.metrics.pollCount,
          wait_duration_ms: flow.metrics.waitDurationMs,
        }
      : {};

    return outcome(ctx, passWithMetrics(tc, start, metricsFields));
  } catch (err) {
    return {
      ctx,
      result: {
        id: tc.id,
        name: tc.name,
        tier: tc.tier,
        status: 'error',
        durationMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
        automation: tc.automation,
      },
    };
  }
}

function outcome(ctx: TestContext, result: TestCaseResult): RunOneCaseOutcome {
  return { ctx, result };
}

function pass(tc: StandardTestCase, start: number): TestCaseResult {
  return passWithMetrics(tc, start, {});
}

function passWithMetrics(
  tc: StandardTestCase,
  start: number,
  extra: Partial<TestCaseResult>
): TestCaseResult {
  return {
    id: tc.id,
    name: tc.name,
    tier: tc.tier,
    status: 'pass',
    durationMs: Date.now() - start,
    automation: tc.automation,
    ...extra,
  };
}

function fail(tc: StandardTestCase, start: number, message: string): TestCaseResult {
  return failWithMetrics(tc, start, message, {});
}

function failWithMetrics(
  tc: StandardTestCase,
  start: number,
  message: string,
  extra: Partial<TestCaseResult>
): TestCaseResult {
  return {
    id: tc.id,
    name: tc.name,
    tier: tc.tier,
    status: 'fail',
    durationMs: Date.now() - start,
    message,
    automation: tc.automation,
    ...extra,
  };
}

function skip(tc: StandardTestCase, start: number, message: string): TestCaseResult {
  return { id: tc.id, name: tc.name, tier: tc.tier, status: 'skip', durationMs: Date.now() - start, message, automation: tc.automation };
}

// ── 主入口 ───────────────────────────────────────────────────────────────────

/**
 * 运行标准测试套件；插件传入 ChannelAdapter 实例。
 */
export async function runStandardTests(
  adapter: ChannelAdapter,
  options: RunStandardTestsOptions = {}
): Promise<{ results: TestCaseResult[]; exitCode: number }> {
  const dataset = await loadDataset(options.datasetPath);
  let cases = dataset.test_cases;

  if (options.tiers?.length) {
    const set = new Set(options.tiers.map((t) => t.toUpperCase()));
    cases = cases.filter((c) => {
      const tier = c.tier.toUpperCase();
      for (const t of set) {
        if (tier === t || tier.startsWith(`${t}-`)) return true;
      }
      return false;
    });
  }
  if (options.ids?.length) {
    const set = new Set(options.ids);
    cases = cases.filter((c) => set.has(c.id));
  }

  console.log('═'.repeat(60));
  console.log(`  OpenClaw Standard Channel Tests — ${adapter.channelId}`);
  console.log(`  Suite: ${dataset.suite_id} (${cases.length} cases)`);
  console.log('═'.repeat(60));

  const results: TestCaseResult[] = [];

  for (const tc of cases) {
    options.onCaseStart?.(tc);
    const { result, ctx } = await runOneCase(adapter, tc, dataset, options);
    results.push(result);
    options.onCaseEnd?.(result);
    options.onCaseEndWithContext?.(result, tc, ctx);

    const icon = { pass: '✓', fail: '✗', skip: '○', error: '!' }[result.status];
    const latHint =
      result.latency_ms !== undefined ? ` lat=${result.latency_ms}ms` : '';
    const pollHint =
      result.poll_count !== undefined ? ` polls=${result.poll_count}` : '';
    const line = `${icon} ${result.id.padEnd(10)} ${result.name.slice(0, 32).padEnd(32)} ${result.status.toUpperCase().padEnd(5)} ${result.durationMs}ms${latHint}${pollHint}`;
    console.log(line);
    if (result.message && result.status !== 'pass') console.log(`    ${result.message}`);
    if (result.status === 'pass' && result.latency_ms !== undefined) {
      console.log(
        `    sent_at=${result.sent_at} reply_at=${result.reply_at} latency_ms=${result.latency_ms} polls=${result.poll_count ?? '-'}`
      );
    }
  }

  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail' || r.status === 'error').length;
  const skip = results.filter((r) => r.status === 'skip').length;

  console.log('─'.repeat(60));
  console.log(`  Total: ${results.length}  Pass: ${pass}  Fail: ${fail}  Skip: ${skip}`);
  console.log('═'.repeat(60));

  return { results, exitCode: fail > 0 ? 1 : 0 };
}

// CLI：需通过环境变量 OPENCLAW_TEST_ADAPTER 指向插件适配器模块（可选）
if (import.meta.url === `file://${process.argv[1]}`) {
  console.error(
    'run-standard-tests.ts is a library entry. Implement ChannelAdapter in your plugin\n' +
      'e.g. extensions/gotify/scripts/run-gotify-standard-tests.ts'
  );
  process.exit(2);
}

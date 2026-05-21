/**
 * OpenClaw Gateway chat.history 辅助 — 用于 E2E / UI 验收门禁。
 * 通过 `openclaw gateway call chat.history --json` 读取 Control UI 同源 transcript。
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** chat.history 单条消息（子集）。 */
export type ChatHistoryMessage = {
  role: string;
  content?: Array<{ type?: string; text?: string }>;
  timestamp?: number;
  senderLabel?: string;
};

/** chat.history RPC 响应（子集）。 */
export type ChatHistoryResponse = {
  sessionKey: string;
  sessionId?: string;
  conversationLabel?: string;
  messages: ChatHistoryMessage[];
};

/**
 * 调用 Gateway `chat.history` 并解析 JSON 响应。
 */
export async function fetchChatHistory(params: {
  sessionKey: string;
  limit?: number;
  gatewayToken?: string;
  timeoutMs?: number;
}): Promise<ChatHistoryResponse> {
  const args = [
    'gateway',
    'call',
    'chat.history',
    '--json',
    '--params',
    JSON.stringify({
      sessionKey: params.sessionKey,
      limit: params.limit ?? 50,
    }),
  ];
  const token = params.gatewayToken ?? process.env.OPENCLAW_GATEWAY_TOKEN;
  if (token?.trim()) {
    args.push('--token', token.trim());
  }
  const timeoutMs = params.timeoutMs ?? 15_000;
  args.push('--timeout', String(timeoutMs));

  const { stdout, stderr } = await execFileAsync('openclaw', args, {
    timeout: timeoutMs + 2_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const raw = stdout.trim();
  if (!raw) {
    throw new Error(`chat.history returned empty stdout${stderr ? `: ${stderr}` : ''}`);
  }
  return JSON.parse(raw) as ChatHistoryResponse;
}

/**
 * 从 chat.history 消息体提取可见文本。
 */
export function extractMessageText(message: ChatHistoryMessage): string {
  const parts = message.content ?? [];
  return parts
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text!.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 查找最近的用户消息：优先匹配 sentText，否则取 sinceMs 之后最新 user 轮次。
 */
export function findRecentUserMessage(
  messages: ChatHistoryMessage[],
  opts: { sentText?: string; sinceMs?: number; maxAgeMs?: number }
): ChatHistoryMessage | undefined {
  const now = Date.now();
  const maxAgeMs = opts.maxAgeMs ?? 60_000;
  const sinceMs = opts.sinceMs ?? now - maxAgeMs;
  const sentNorm = opts.sentText?.trim();

  const userMessages = messages.filter((m) => m.role === 'user');

  const isRecentEnough = (msg: ChatHistoryMessage): boolean => {
    const ts = msg.timestamp ?? 0;
    if (!ts) return true;
    if (ts >= sinceMs - 2_000) return true;
    return now - ts <= maxAgeMs + 5_000;
  };

  if (sentNorm) {
    for (let i = userMessages.length - 1; i >= 0; i -= 1) {
      const msg = userMessages[i]!;
      if (!isRecentEnough(msg)) continue;
      const text = extractMessageText(msg);
      if (text.includes(sentNorm) || sentNorm.includes(text)) {
        return msg;
      }
    }
  }

  for (let i = userMessages.length - 1; i >= 0; i -= 1) {
    const msg = userMessages[i]!;
    if (isRecentEnough(msg)) {
      return msg;
    }
  }

  return undefined;
}

/**
 * 等待 transcript 中出现用户消息（Control UI 验收门禁核心）。
 */
export async function waitForUserTranscript(params: {
  sessionKey: string;
  sentText?: string;
  sinceMs: number;
  timeoutMs?: number;
  pollMs?: number;
  gatewayToken?: string;
}): Promise<{
  history: ChatHistoryResponse;
  userMessage: ChatHistoryMessage;
  userText: string;
  polls: number;
  waitedMs: number;
}> {
  const timeoutMs = params.timeoutMs ?? 120_000;
  const pollMs = params.pollMs ?? 250;
  const start = Date.now();
  let polls = 0;
  let lastHistory: ChatHistoryResponse | null = null;

  while (Date.now() - start < timeoutMs) {
    polls += 1;
    lastHistory = await fetchChatHistory({
      sessionKey: params.sessionKey,
      limit: 20,
      gatewayToken: params.gatewayToken,
    });
    const userMessage = findRecentUserMessage(lastHistory.messages, {
      sentText: params.sentText,
      sinceMs: params.sinceMs,
    });
    if (userMessage) {
      return {
        history: lastHistory,
        userMessage,
        userText: extractMessageText(userMessage),
        polls,
        waitedMs: Date.now() - start,
      };
    }
    await sleep(pollMs);
  }

  const msgCount = lastHistory?.messages.length ?? 0;
  throw new TranscriptGateError({
    sessionKey: params.sessionKey,
    messageCount: msgCount,
    sentText: params.sentText,
    polls,
    waitedMs: Date.now() - start,
    lastHistory,
  });
}

/** UI 验收失败 — 含排查指引。 */
export class TranscriptGateError extends Error {
  readonly sessionKey: string;
  readonly messageCount: number;
  readonly polls: number;
  readonly waitedMs: number;
  readonly lastHistory: ChatHistoryResponse | null;

  constructor(details: {
    sessionKey: string;
    messageCount: number;
    sentText?: string;
    polls: number;
    waitedMs: number;
    lastHistory: ChatHistoryResponse | null;
  }) {
    const lines = [
      'UI TRANSCRIPT GATE FAILED — chat.history 中无匹配 user 消息',
      '',
      `  sessionKey:    ${details.sessionKey}`,
      `  messages:      ${details.messageCount}`,
      `  sentText:      ${details.sentText ?? '(any recent user)'}`,
      `  polls:         ${details.polls}`,
      `  waited:        ${details.waitedMs}ms`,
      '',
      '排查步骤:',
      '  1. 确认 Gateway 运行: openclaw gateway status',
      '  2. Control UI → Sessions → 选 gotify 会话（非 agent:main:main）',
      '  3. 检查 ~/.openclaw/openclaw.json session.dmScope 与会话键一致',
      '  4. 查看 Gateway 日志: openclaw gateway logs --follow',
      '  5. 确认 gotify 插件 WS 入站: channels.gotify.inbound.enabled + clientToken',
      '  6. 单元测试(vitest)通过 ≠ UI 有消息；必须 pnpm test:ui-gate 通过',
    ];
    super(lines.join('\n'));
    this.name = 'TranscriptGateError';
    this.sessionKey = details.sessionKey;
    this.messageCount = details.messageCount;
    this.polls = details.polls;
    this.waitedMs = details.waitedMs;
    this.lastHistory = details.lastHistory;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

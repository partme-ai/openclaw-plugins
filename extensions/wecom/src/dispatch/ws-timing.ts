/**
 * @module ws-timing
 *
 * WebSocket 入站链路耗时观测：
 * - `WECOM_WS_TIMING=1` 或 `OPENCLAW_DEBUG` 含 `wecom-ws`：全阶段日志
 * - 任意阶段 elapsed ≥ {@link WECOM_WS_SLOW_STAGE_MS}：始终 info 级慢阶段日志
 */

import type { RuntimeEnv } from "openclaw/plugin-sdk/runtime-env";

/** 慢阶段告警阈值（毫秒）；超过则始终输出 info 日志。 */
export const WECOM_WS_SLOW_STAGE_MS = 1_000;

/** 是否启用 WS 首响耗时日志。 */
export function isWeComWsTimingEnabled(): boolean {
  const explicit = process.env.WECOM_WS_TIMING?.trim();
  if (explicit === "1" || explicit?.toLowerCase() === "true") {
    return true;
  }
  const openclawDebug = process.env.OPENCLAW_DEBUG?.toLowerCase() ?? "";
  return openclawDebug.includes("wecom-ws");
}

/** 单次 WS 消息处理的时间线上下文。 */
export type WsTimingContext = {
  /** 单调起点（`performance.now()`） */
  t0: number;
  accountId: string;
  chatId: string;
  msgIdSuffix: string;
};

/**
 * 创建 WS 耗时观测上下文。
 *
 * @param params.accountId - 账号 ID
 * @param params.chatId - 会话 ID
 * @param params.messageId - 企微 msgid
 */
export function createWsTimingContext(params: {
  accountId: string;
  chatId: string;
  messageId: string;
}): WsTimingContext {
  return {
    t0: performance.now(),
    accountId: params.accountId,
    chatId: compactChatId(params.chatId),
    msgIdSuffix: compactMsgId(params.messageId),
  };
}

/**
 * 输出阶段性耗时日志。
 *
 * - `WECOM_WS_TIMING=1`：每个 stage 均输出
 * - elapsed ≥ {@link WECOM_WS_SLOW_STAGE_MS}：始终输出（`[wecom-ws-slow]` 前缀）
 *
 * @param ctx - 时间线上下文
 * @param stage - 阶段名（如 `prepare.done`）
 * @param extra - 可选附加键值
 * @param options.runtime - 慢阶段优先写入 runtime.log（info）
 */
export function logWsTimingStage(
  ctx: WsTimingContext,
  stage: string,
  extra?: Record<string, string | number | boolean | undefined>,
  options?: { runtime?: RuntimeEnv },
): void {
  const elapsedMs = Math.round(performance.now() - ctx.t0);
  const fullTiming = isWeComWsTimingEnabled();
  const slow = elapsedMs >= WECOM_WS_SLOW_STAGE_MS;
  if (!fullTiming && !slow) {
    return;
  }

  const suffixParts: string[] = [];
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        suffixParts.push(`${key}=${value}`);
      }
    }
  }

  const baseParts = [
    `stage=${stage}`,
    `account=${ctx.accountId}`,
    `chat=${ctx.chatId}`,
    `msg=…${ctx.msgIdSuffix}`,
    `elapsedMs=${elapsedMs}`,
    ...suffixParts,
  ];
  const line = baseParts.join(" ");

  if (slow) {
    const slowLine = `[wecom-ws-slow] ${line}`;
    if (options?.runtime?.log) {
      options.runtime.log(slowLine);
    } else {
      console.log(slowLine);
    }
  }

  if (fullTiming) {
    console.log(`[wecom-ws-timing] ${line}`);
  }
}

function compactChatId(chatId: string): string {
  if (chatId.length <= 8) return chatId;
  return `…${chatId.slice(-6)}`;
}

function compactMsgId(messageId: string): string {
  if (messageId.length <= 8) return messageId;
  return messageId.slice(-8);
}

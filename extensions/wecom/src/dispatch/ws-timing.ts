/**
 * @module ws-timing
 *
 * WebSocket 入站链路耗时观测（`WECOM_WS_TIMING=1` 或 `OPENCLAW_DEBUG` 含 `wecom-ws`）。
 */

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
 * 输出阶段性耗时日志（仅在 timing 开关开启时）。
 *
 * @param ctx - 时间线上下文
 * @param stage - 阶段名（如 `prepare.done`）
 * @param extra - 可选附加键值
 */
export function logWsTimingStage(
  ctx: WsTimingContext,
  stage: string,
  extra?: Record<string, string | number | boolean | undefined>,
): void {
  if (!isWeComWsTimingEnabled()) {
    return;
  }
  const elapsedMs = Math.round(performance.now() - ctx.t0);
  const parts = [
    `[wecom-ws-timing] stage=${stage}`,
    `account=${ctx.accountId}`,
    `chat=${ctx.chatId}`,
    `msg=…${ctx.msgIdSuffix}`,
    `elapsedMs=${elapsedMs}`,
  ];
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        parts.push(`${key}=${value}`);
      }
    }
  }
  console.log(parts.join(" "));
}

function compactChatId(chatId: string): string {
  if (chatId.length <= 8) return chatId;
  return `…${chatId.slice(-6)}`;
}

function compactMsgId(messageId: string): string {
  if (messageId.length <= 8) return messageId;
  return messageId.slice(-8);
}

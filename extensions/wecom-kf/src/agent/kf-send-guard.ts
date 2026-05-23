/**
 * @module agent/kf-send-guard
 *
 * KF send_msg 运行时限制：48 小时回复窗口 + 每条客户消息最多 5 条回复。
 * 与企微文档 94677 对齐；进程内状态，重启后重置计数。
 */

/** KF 主动回复限制常量 */
export const KF_SEND_LIMITS = {
  /** 客户最后一条消息后的可回复窗口（48 小时） */
  REPLY_WINDOW_MS: 48 * 60 * 60 * 1000,
  /** 单条客户消息触发的回复上限 */
  MAX_REPLIES_PER_CUSTOMER_MSG: 5,
} as const;

export type KfSendGuardCode =
  | "reply_window_expired"
  | "reply_count_exceeded"
  | "no_customer_inbound";

type SessionSendState = {
  lastCustomerMsgAt: number;
  lastCustomerMsgId?: string;
  replyCount: number;
};

const sessionStates = new Map<string, SessionSendState>();

/**
 * 构造会话级 guard 键。
 */
function buildSessionKey(openKfId: string, externalUserId: string): string {
  return `${openKfId.trim()}:${externalUserId.trim()}`;
}

/**
 * 客户入站时重置回复计数并刷新 48h 窗口起点。
 */
export function onKfCustomerInbound(params: {
  openKfId: string;
  externalUserId: string;
  msgId?: string;
  sendTimeMs?: number;
}): void {
  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  if (!openKfId || !externalUserId) return;

  sessionStates.set(buildSessionKey(openKfId, externalUserId), {
    lastCustomerMsgAt: params.sendTimeMs ?? Date.now(),
    lastCustomerMsgId: params.msgId?.trim() || undefined,
    replyCount: 0,
  });
}

/**
 * 校验是否允许继续 send_msg。
 */
export function checkKfSendAllowed(params: {
  openKfId: string;
  externalUserId: string;
  nowMs?: number;
}): { allowed: true } | { allowed: false; reason: string; code: KfSendGuardCode } {
  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  const nowMs = params.nowMs ?? Date.now();
  const state = sessionStates.get(buildSessionKey(openKfId, externalUserId));

  if (!state) {
    return {
      allowed: false,
      code: "no_customer_inbound",
      reason: "未记录客户入站消息，跳过 send_msg（可能尚未收到客户消息或进程已重启）",
    };
  }

  if (nowMs - state.lastCustomerMsgAt > KF_SEND_LIMITS.REPLY_WINDOW_MS) {
    return {
      allowed: false,
      code: "reply_window_expired",
      reason: `已超过 48 小时回复窗口（lastCustomerMsgAt=${new Date(state.lastCustomerMsgAt).toISOString()}）`,
    };
  }

  if (state.replyCount >= KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG) {
    return {
      allowed: false,
      code: "reply_count_exceeded",
      reason: `已达到单条客户消息 ${KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG} 条回复上限`,
    };
  }

  return { allowed: true };
}

/**
 * 成功 send_msg 后递增回复计数。
 */
export function recordKfOutboundSend(params: {
  openKfId: string;
  externalUserId: string;
  count?: number;
}): void {
  const key = buildSessionKey(params.openKfId, params.externalUserId);
  const state = sessionStates.get(key);
  if (!state) return;
  state.replyCount += Math.max(1, params.count ?? 1);
}

/**
 * 测试或运维用途：读取当前会话 guard 状态。
 */
export function peekKfSendGuardState(
  openKfId: string,
  externalUserId: string,
): SessionSendState | undefined {
  return sessionStates.get(buildSessionKey(openKfId, externalUserId));
}

/**
 * 测试用途：清空 guard 状态。
 */
export function resetKfSendGuardForTests(): void {
  sessionStates.clear();
}

/**
 * @module agent/kf-send-guard
 *
 * KF send_msg 运行时限制：48 小时回复窗口 + 每条客户消息最多 5 条回复。
 * 与企微文档 94677 对齐；状态持久化至 state 目录 JSON，重启不丢失计数。
 */

import { DurableJsonMapStore } from "../state/durable-json-map.js";

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

/**
 * 一次出站额度预占凭证。
 *
 * `lastCustomerMsgAt/Id` 用来识别预占属于哪一轮客户消息：若发送期间客户又发来
 * 新消息并重置计数，失败回滚不能误减新一轮消息的额度。
 */
export type KfSendReservation = {
  key: string;
  lastCustomerMsgAt: number;
  lastCustomerMsgId?: string;
};

const store = new DurableJsonMapStore<SessionSendState>("send-guard-states.json");
let loadPromise: Promise<void> | undefined;
/** 同一会话的状态变更串行化，避免并发 check-then-set 穿透 5 条上限。 */
const sessionMutationQueues = new Map<string, Promise<void>>();

async function withSessionMutationLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionMutationQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => current);
  sessionMutationQueues.set(key, queued);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (sessionMutationQueues.get(key) === queued) {
      sessionMutationQueues.delete(key);
    }
  }
}

/**
 * 预热 guard store（插件启动时可调用）。
 */
export async function initKfSendGuardStore(): Promise<void> {
  await store.load();
}

async function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = store.load();
  }
  await loadPromise;
}

/**
 * 构造会话级 guard 键。
 */
function buildSessionKey(openKfId: string, externalUserId: string): string {
  return `${openKfId.trim()}:${externalUserId.trim()}`;
}

/**
 * 客户入站时重置回复计数并刷新 48h 窗口起点。
 */
export async function onKfCustomerInbound(params: {
  openKfId: string;
  externalUserId: string;
  msgId?: string;
  sendTimeMs?: number;
}): Promise<void> {
  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  if (!openKfId || !externalUserId) return;

  const next: SessionSendState = {
    lastCustomerMsgAt: params.sendTimeMs ?? Date.now(),
    lastCustomerMsgId: params.msgId?.trim() || undefined,
    replyCount: 0,
  };

  await ensureLoaded();
  const key = buildSessionKey(openKfId, externalUserId);
  await withSessionMutationLock(key, () => store.set(key, next));
}

/**
 * 校验是否允许继续 send_msg。
 */
export async function checkKfSendAllowed(params: {
  openKfId: string;
  externalUserId: string;
  nowMs?: number;
}): Promise<{ allowed: true } | { allowed: false; reason: string; code: KfSendGuardCode }> {
  await ensureLoaded();

  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  const nowMs = params.nowMs ?? Date.now();
  const state = store.get(buildSessionKey(openKfId, externalUserId));

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
 * 同步版 guard 检查（兼容旧调用；内部读已加载内存）。
 */
export function checkKfSendAllowedSync(params: {
  openKfId: string;
  externalUserId: string;
  nowMs?: number;
}): { allowed: true } | { allowed: false; reason: string; code: KfSendGuardCode } {
  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  const nowMs = params.nowMs ?? Date.now();
  const state = store.get(buildSessionKey(openKfId, externalUserId));

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
export async function recordKfOutboundSend(params: {
  openKfId: string;
  externalUserId: string;
  count?: number;
}): Promise<void> {
  const key = buildSessionKey(params.openKfId, params.externalUserId);
  await ensureLoaded();
  await withSessionMutationLock(key, async () => {
    const state = store.get(key);
    if (!state) return;
    await store.set(key, {
      ...state,
      replyCount: state.replyCount + Math.max(1, params.count ?? 1),
    });
  });
}

/**
 * 原子校验并预占一条回复额度。
 *
 * 为什么在调用企微 API **之前**计数：若等 HTTP 成功后再计数，并发请求会同时
 * 通过检查，最终突破 5 条限制。调用方必须在 API 明确失败或抛错时调用
 * {@link rollbackKfSendReservation} 归还额度。
 */
export async function reserveKfOutboundSend(params: {
  openKfId: string;
  externalUserId: string;
  nowMs?: number;
}): Promise<
  | { allowed: true; reservation: KfSendReservation }
  | { allowed: false; reason: string; code: KfSendGuardCode }
> {
  await ensureLoaded();
  const key = buildSessionKey(params.openKfId, params.externalUserId);

  return withSessionMutationLock(key, async () => {
    const state = store.get(key);
    if (!state) {
      return {
        allowed: false as const,
        code: "no_customer_inbound" as const,
        reason: "未记录客户入站消息，跳过 send_msg（可能尚未收到客户消息或进程已重启）",
      };
    }

    const nowMs = params.nowMs ?? Date.now();
    if (nowMs - state.lastCustomerMsgAt > KF_SEND_LIMITS.REPLY_WINDOW_MS) {
      return {
        allowed: false as const,
        code: "reply_window_expired" as const,
        reason: `已超过 48 小时回复窗口（lastCustomerMsgAt=${new Date(state.lastCustomerMsgAt).toISOString()}）`,
      };
    }
    if (state.replyCount >= KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG) {
      return {
        allowed: false as const,
        code: "reply_count_exceeded" as const,
        reason: `已达到单条客户消息 ${KF_SEND_LIMITS.MAX_REPLIES_PER_CUSTOMER_MSG} 条回复上限`,
      };
    }

    await store.set(key, { ...state, replyCount: state.replyCount + 1 });
    return {
      allowed: true as const,
      reservation: {
        key,
        lastCustomerMsgAt: state.lastCustomerMsgAt,
        lastCustomerMsgId: state.lastCustomerMsgId,
      },
    };
  });
}

/** API 发送失败时归还预占额度；客户已产生新入站时不触碰新一轮计数。 */
export async function rollbackKfSendReservation(reservation: KfSendReservation): Promise<void> {
  await ensureLoaded();
  await withSessionMutationLock(reservation.key, async () => {
    const state = store.get(reservation.key);
    if (
      !state ||
      state.lastCustomerMsgAt !== reservation.lastCustomerMsgAt ||
      state.lastCustomerMsgId !== reservation.lastCustomerMsgId
    ) {
      return;
    }
    await store.set(reservation.key, {
      ...state,
      replyCount: Math.max(0, state.replyCount - 1),
    });
  });
}

/**
 * 测试或运维用途：读取当前会话 guard 状态。
 */
export async function peekKfSendGuardState(
  openKfId: string,
  externalUserId: string,
): Promise<SessionSendState | undefined> {
  await ensureLoaded();
  return store.get(buildSessionKey(openKfId, externalUserId));
}

/**
 * 测试用途：清空 guard 状态。
 */
export async function resetKfSendGuardForTests(storeDir?: string): Promise<void> {
  if (storeDir) {
    const testStore = new DurableJsonMapStore<SessionSendState>("send-guard-states.json", storeDir);
    await testStore.clear();
  } else {
    await store.clear();
  }
  loadPromise = undefined;
  sessionMutationQueues.clear();
}

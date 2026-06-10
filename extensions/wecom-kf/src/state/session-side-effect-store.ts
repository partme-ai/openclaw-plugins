/**
 * @module kf/session-side-effect-store
 *
 * **KfSessionSideEffectStore** — 持久化 trans 返回的 `msg_code`，供
 * `send_msg_on_event` 发送排队语 / 结束语 / 满意度（P3-03）。
 */

import { DurableJsonMapStore } from "./durable-json-map.js";

/** trans 或 session 事件产生的待消费 side-effect */
export type KfSessionSideEffect = {
  msgCode: string;
  openKfId: string;
  externalUserId: string;
  serviceState: number;
  createdAt: number;
  consumed: boolean;
};

const store = new DurableJsonMapStore<KfSessionSideEffect>("session-side-effects.json");

function buildSideEffectKey(params: {
  openKfId: string;
  externalUserId: string;
  msgCode: string;
}): string {
  return `${params.openKfId.trim()}:${params.externalUserId.trim()}:${params.msgCode.trim()}`;
}

/**
 * 入队 msg_code side-effect（transfer 成功或 session 事件携带）。
 */
export async function enqueueKfSessionSideEffect(params: {
  msgCode: string;
  openKfId: string;
  externalUserId: string;
  serviceState: number;
}): Promise<void> {
  const msgCode = params.msgCode.trim();
  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  if (!msgCode || !openKfId || !externalUserId) return;

  await store.set(buildSideEffectKey({ openKfId, externalUserId, msgCode }), {
    msgCode,
    openKfId,
    externalUserId,
    serviceState: params.serviceState,
    createdAt: Date.now(),
    consumed: false,
  });
}

/**
 * 列出未消费的 side-effect（按创建时间升序）。
 */
export async function listPendingKfSessionSideEffects(): Promise<KfSessionSideEffect[]> {
  await store.load();
  return store
    .entries()
    .map(([, value]) => value)
    .filter((item) => !item.consumed)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 标记 side-effect 已消费。
 */
export async function markKfSessionSideEffectConsumed(params: {
  openKfId: string;
  externalUserId: string;
  msgCode: string;
}): Promise<void> {
  const key = buildSideEffectKey(params);
  await store.load();
  const existing = store.get(key);
  if (!existing) return;
  await store.set(key, { ...existing, consumed: true });
}

/** 测试专用：清空 side-effect store */
export async function resetKfSessionSideEffectStoreForTests(): Promise<void> {
  await store.clear();
}

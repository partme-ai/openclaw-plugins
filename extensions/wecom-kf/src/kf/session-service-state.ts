/**
 * @module kf/session-service-state
 *
 * 持久化 KF 会话 service_state（企微 94669），用于：
 * - P3-02：`service_state=3` 时停止 Agent 自动回复
 * - 转人工 / session_status_change 事件同步
 */

import { DurableJsonMapStore } from "../store/durable-json-map.js";

/** 单会话 service_state 快照 */
export type KfSessionServiceStateRecord = {
  serviceState: number;
  updatedAt: number;
  servicerUserId?: string;
  changeType?: number;
};

const store = new DurableJsonMapStore<KfSessionServiceStateRecord>("session-service-states.json");

/**
 * 构造会话级键：`open_kfid:external_userid`。
 */
export function buildKfSessionKey(openKfId: string, externalUserId: string): string {
  return `${openKfId.trim()}:${externalUserId.trim()}`;
}

/**
 * 人工接待(3)或已结束(4)时，Agent 不应再自动回复。
 */
export function isKfAgentReplyBlocked(serviceState: number | undefined): boolean {
  return serviceState === 3 || serviceState === 4;
}

/**
 * 读取会话 service_state（内存 + 磁盘）。
 */
export async function getKfSessionServiceState(
  openKfId: string,
  externalUserId: string,
): Promise<KfSessionServiceStateRecord | undefined> {
  await store.load();
  return store.get(buildKfSessionKey(openKfId, externalUserId));
}

/**
 * 更新会话 service_state 并持久化。
 */
export async function setKfSessionServiceState(params: {
  openKfId: string;
  externalUserId: string;
  serviceState: number;
  servicerUserId?: string;
  changeType?: number;
}): Promise<void> {
  const openKfId = params.openKfId.trim();
  const externalUserId = params.externalUserId.trim();
  if (!openKfId || !externalUserId) return;

  await store.set(buildKfSessionKey(openKfId, externalUserId), {
    serviceState: params.serviceState,
    updatedAt: Date.now(),
    servicerUserId: params.servicerUserId?.trim() || undefined,
    changeType: params.changeType,
  });
}

/** 测试专用：重置 store */
export async function resetKfSessionServiceStateForTests(storeDir?: string): Promise<void> {
  if (storeDir) {
    const testStore = new DurableJsonMapStore<KfSessionServiceStateRecord>(
      "session-service-states.json",
      storeDir,
    );
    await testStore.clear();
    return;
  }
  await store.clear();
}

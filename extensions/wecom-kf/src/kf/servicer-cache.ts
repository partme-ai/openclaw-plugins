/**
 * @module kf/servicer-cache
 *
 * 转人工路由运行时：接待人员列表内存缓存与 94645 刷新。
 * 供 `transfer-policy`、`control-tools` 共用，避免重复拉取。
 */

import { listKfServicers } from "../agent/api-client.js";
import type { ResolvedAgentAccount, ServicerInfo } from "../types/index.js";

const servicerCache = new Map<string, ServicerInfo[]>();
const servicerCacheUpdatedAt = new Map<string, number>();

/** 默认缓存 TTL：5 分钟 */
export const SERVICER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * 写入接待人员缓存。
 */
export function cacheServicers(openKfId: string, servicers: ServicerInfo[]): void {
  const normalizedKfId = openKfId.trim();
  if (!normalizedKfId) return;
  servicerCache.set(
    normalizedKfId,
    servicers.map((servicer) => ({ ...servicer })),
  );
  servicerCacheUpdatedAt.set(normalizedKfId, Date.now());
}

/**
 * 读取缓存副本（可能为空）。
 */
export function getCachedServicers(openKfId: string): ServicerInfo[] {
  return (servicerCache.get(openKfId.trim()) ?? []).map((servicer) => ({ ...servicer }));
}

/**
 * 过滤在线接待人员（status=0）。
 */
export function getOnlineServicers(openKfId: string): ServicerInfo[] {
  return getCachedServicers(openKfId).filter((servicer) => servicer.status === 0);
}

/**
 * 判断缓存是否过期。
 */
export function isServicerCacheStale(openKfId: string, ttlMs = SERVICER_CACHE_TTL_MS): boolean {
  const updatedAt = servicerCacheUpdatedAt.get(openKfId.trim());
  if (updatedAt == null) return true;
  return Date.now() - updatedAt >= ttlMs;
}

/**
 * 从企微 API 刷新接待人员列表并更新缓存。
 */
export async function refreshServicersFromApi(params: {
  agent: ResolvedAgentAccount;
  openKfId: string;
  force?: boolean;
}): Promise<{ ok: boolean; count: number; errcode?: number; errmsg?: string }> {
  const openKfId = params.openKfId.trim();
  if (!openKfId) {
    return { ok: false, count: 0, errmsg: "missing open_kfid" };
  }

  if (!params.force && !isServicerCacheStale(openKfId)) {
    return { ok: true, count: getCachedServicers(openKfId).length };
  }

  const data = await listKfServicers({ agent: params.agent, openKfId });
  if (data.errcode !== 0) {
    return { ok: false, count: 0, errcode: data.errcode, errmsg: data.errmsg };
  }

  const servicers = (data.servicer_list ?? []).map((item) => ({
    userid: item.userid,
    status: item.status,
    department_id: item.department_id,
  }));
  cacheServicers(openKfId, servicers);
  return { ok: true, count: servicers.length };
}

/** 测试专用：清空接待人员缓存 */
export function resetServicerCacheForTests(): void {
  servicerCache.clear();
  servicerCacheUpdatedAt.clear();
}

/**
 * @module kf/transfer-policy
 *
 * 转人工时自动选择在线接待人员（P3-01）。
 * 优先使用显式 `servicer_userid`；否则从运行时缓存中选第一个在线坐席。
 */

import type { ResolvedAgentAccount } from "../types/index.js";
import { getOnlineServicers, refreshServicersFromApi } from "./servicer-cache.js";

export type ResolveTransferServicerResult =
  | { ok: true; servicerUserId: string; autoSelected: boolean }
  | { ok: false; error: string };

/**
 * 解析转人工目标 servicer_userid。
 *
 * @param params.explicitServicerUserId - Tool/调用方显式指定
 * @param params.refreshIfStale - 缓存过期时自动刷新 94645
 */
export async function resolveTransferServicerUserId(params: {
  agent: ResolvedAgentAccount;
  openKfId: string;
  explicitServicerUserId?: string;
  refreshIfStale?: boolean;
}): Promise<ResolveTransferServicerResult> {
  const explicit = params.explicitServicerUserId?.trim();
  if (explicit) {
    return { ok: true, servicerUserId: explicit, autoSelected: false };
  }

  const openKfId = params.openKfId.trim();
  if (!openKfId) {
    return { ok: false, error: "缺少 open_kfid" };
  }

  if (params.refreshIfStale !== false) {
    const refreshed = await refreshServicersFromApi({
      agent: params.agent,
      openKfId,
    });
    if (!refreshed.ok && refreshed.errcode != null) {
      return { ok: false, error: refreshed.errmsg ?? "刷新接待人员列表失败" };
    }
  }

  const online = getOnlineServicers(openKfId);
  const picked = online[0]?.userid?.trim();
  if (!picked) {
    return { ok: false, error: "无在线接待人员，请稍后重试或指定 servicer_userid" };
  }

  return { ok: true, servicerUserId: picked, autoSelected: true };
}

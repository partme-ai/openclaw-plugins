/**
 * @fileoverview mTLS 中间件请求统计（认证/拒绝/透传计数）。
 *
 * @module mtls/runtime/stats
 */

import type { MtlsStatusSnapshot } from "../shared/types.js";

const stats: MtlsStatusSnapshot = {
  totalRequests: 0,
  authenticatedRequests: 0,
  rejectedRequests: 0,
  passthroughRequests: 0,
  activeSessions: 0,
};

/**
 * 返回 mTLS 中间件统计快照（浅拷贝，避免外部修改内部计数器）。
 *
 * @returns 当前请求认证/拒绝/透传计数
 */
export function getMtlsStats(): MtlsStatusSnapshot {
  return { ...stats };
}

/**
 * 记录一次已经完成授权判定的 HTTP 或 WebSocket Upgrade 请求。
 *
 * 每个请求只能按最终结果调用一次：证书认证成功、拒绝或公开路径匿名放行，避免重试过程重复计数。
 */
export function recordMtlsRequest(kind: "authenticated" | "rejected" | "passthrough"): void {
  stats.totalRequests++;
  if (kind === "authenticated") stats.authenticatedRequests++;
  if (kind === "rejected") stats.rejectedRequests++;
  if (kind === "passthrough") stats.passthroughRequests++;
}

/**
 * 在 WebSocket 隧道建立或关闭时调整活跃会话数。
 *
 * 建连成功后传入 `1`，任一关闭路径只应传入一次 `-1`；下限钳制为零可避免异常/重复关闭事件
 * 让监控指标出现负数，但不能替代调用方的幂等清理。
 */
export function trackMtlsSession(delta: 1 | -1): void {
  stats.activeSessions = Math.max(0, stats.activeSessions + delta);
}

/** 重置所有 mTLS 统计计数为 0（主要用于测试）。 */
export function resetMtlsStats(): void {
  stats.totalRequests = 0;
  stats.authenticatedRequests = 0;
  stats.rejectedRequests = 0;
  stats.passthroughRequests = 0;
  stats.activeSessions = 0;
}

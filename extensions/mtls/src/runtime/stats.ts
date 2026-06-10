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

/** 重置所有 mTLS 统计计数为 0（主要用于测试）。 */
export function resetMtlsStats(): void {
  stats.totalRequests = 0;
  stats.authenticatedRequests = 0;
  stats.rejectedRequests = 0;
  stats.passthroughRequests = 0;
  stats.activeSessions = 0;
}

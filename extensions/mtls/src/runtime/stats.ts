/**
 * mTLS 安全插件统计数据
 */

import type { MtlsStatusSnapshot } from "../shared/types.js";

const stats: MtlsStatusSnapshot = {
  totalRequests: 0,
  authenticatedRequests: 0,
  rejectedRequests: 0,
  passthroughRequests: 0,
  activeSessions: 0,
};

export function getMtlsStats(): MtlsStatusSnapshot {
  return { ...stats };
}

export function resetMtlsStats(): void {
  stats.totalRequests = 0;
  stats.authenticatedRequests = 0;
  stats.rejectedRequests = 0;
  stats.passthroughRequests = 0;
  stats.activeSessions = 0;
}

/**
 * @fileoverview MQTT Prometheus metrics collector — 委托 message-sdk/transport 共享工厂。
 *
 * @module mqtt/shared/metrics
 *
 * prom-client 为可选依赖：未安装时指标更新函数静默 no-op，避免插件加载失败。
 */

import {
  createTransportMetrics,
  type TransportMetrics,
} from "@partme.ai/openclaw-message-sdk/transport/metrics";

let metrics: TransportMetrics | null | undefined;

/**
 * 懒加载 TransportMetrics；prom-client 缺失时返回 null。
 */
function getMetricsInstance(): TransportMetrics | null {
  if (metrics !== undefined) {
    return metrics;
  }
  try {
    metrics = createTransportMetrics({ prefix: "mqtt_" });
  } catch {
    metrics = null;
  }
  return metrics;
}

/** 导出 Prometheus 文本指标；未启用 metrics 时返回空字符串。 */
export async function getMetrics(): Promise<string> {
  const instance = getMetricsInstance();
  return instance ? instance.getMetrics() : "";
}

/** 导出 Prometheus JSON 指标；未启用 metrics 时返回空数组。 */
export async function getMetricsJson(): Promise<unknown> {
  const instance = getMetricsInstance();
  return instance ? instance.getMetricsJson() : [];
}

/**
 * 更新连接相关指标。
 */
export function updateConnectionMetrics(
  connected: number,
  connections: number,
  disconnections: number,
): void {
  const instance = getMetricsInstance();
  if (!instance) return;
  instance.setConnectedClients(connected);
  instance.incConnections(connections);
  instance.incDisconnections(disconnections);
}

/**
 * 更新消息收发指标。
 */
export function updateMessageMetrics(
  topic: string,
  qos: 0 | 1 | 2,
  direction: "inbound" | "outbound",
): void {
  const instance = getMetricsInstance();
  if (!instance) return;
  const labels = { topic, qos: `qos${qos}` };
  if (direction === "inbound") {
    instance.incMessagesReceived(labels);
  } else {
    instance.incMessagesPublished(labels);
  }
}

/**
 * 更新丢弃消息指标。
 */
export function updateDroppedMetrics(
  reason: "oversized" | "qos0_soft_limit" | "auth" | "inbound_queue_full",
): void {
  getMetricsInstance()?.incMessagesDropped({ reason });
}

/** 更新 QoS0 软限丢弃计数。 */
export function updateQos0Dropped(): void {
  getMetricsInstance()?.incMessagesDropped({ reason: "qos0_soft_limit" });
}

/** 记录消息处理延迟。 */
export function updateMessageLatency(latencyMs: number): void {
  getMetricsInstance()?.observeMessageLatency(latencyMs);
}

/** 更新认证尝试指标。 */
export function updateAuthMetrics(success: boolean): void {
  getMetricsInstance()?.incAuthAttempts(success);
}

/** 更新 ACL 拒绝指标。 */
export function updateAclDenials(action: string, topic: string): void {
  getMetricsInstance()?.incAclDenials({ action, topic });
}

/** 更新会话指标。 */
export function updateSessionMetrics(active: number, pendingExpiry: number): void {
  const instance = getMetricsInstance();
  if (!instance) return;
  instance.setActiveSessions(active);
  instance.setSessionsPendingExpiry(pendingExpiry);
}

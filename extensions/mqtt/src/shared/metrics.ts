/**
 * @fileoverview MQTT Prometheus metrics collector — 委托 message-sdk/transport 共享工厂。
 *
 * @module mqtt/shared/metrics
 */

import { createTransportMetrics, type TransportMetrics } from "@partme.ai/openclaw-message-sdk/transport/metrics";

/** MQTT 专用 TransportMetrics 实例 */
const m: TransportMetrics = createTransportMetrics({ prefix: "mqtt_" });

// ──────────────────── 便捷导出 ────────────────────

export const getMetrics = m.getMetrics;
export const getMetricsJson = m.getMetricsJson;

// ──────────────────── 更新函数 ────────────────────

export function updateConnectionMetrics(connected: number, connections: number, disconnections: number): void {
  m.setConnectedClients(connected);
  m.incConnections(connections);
  m.incDisconnections(disconnections);
}

export function updateMessageMetrics(topic: string, qos: 0 | 1 | 2, direction: "inbound" | "outbound"): void {
  const labels = { topic, qos: `qos${qos}` };
  if (direction === "inbound") {
    m.incMessagesReceived(labels);
  } else {
    m.incMessagesPublished(labels);
  }
}

export function updateDroppedMetrics(reason: "oversized" | "qos0_soft_limit" | "auth"): void {
  m.incMessagesDropped({ reason });
}

export function updateQos0Dropped(): void {
  m.incMessagesDropped({ reason: "qos0_soft_limit" });
}

export function updateMessageLatency(latencyMs: number): void {
  m.observeMessageLatency(latencyMs);
}

export function updateAuthMetrics(success: boolean): void {
  m.incAuthAttempts(success);
}

export function updateAclDenials(action: string, topic: string): void {
  m.incAclDenials({ action, topic });
}

export function updateSessionMetrics(active: number, pendingExpiry: number): void {
  m.setActiveSessions(active);
  m.setSessionsPendingExpiry(pendingExpiry);
}

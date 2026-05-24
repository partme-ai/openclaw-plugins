/**
 * @fileoverview MQTT Prometheus metrics collector — broker 健康与性能指标。
 *
 * @module mqtt/shared/metrics
 *
 * Provides comprehensive metrics for monitoring MQTT broker health and performance.
 */

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from "prom-client";

// Create a custom registry
export const mqttRegistry = new Registry();

// Collect default Node.js metrics
collectDefaultMetrics({ register: mqttRegistry, prefix: "mqtt_" });

// ─────────────────── Connection Metrics ───────────────────

/** Total number of connected MQTT clients */
export const mqttConnectedClients = new Gauge({
  name: "mqtt_connected_clients",
  help: "Current number of connected MQTT clients",
  registers: [mqttRegistry],
});

/** Total number of client connections since start */
export const mqttConnectionsTotal = new Counter({
  name: "mqtt_connections_total",
  help: "Total number of client connections since start",
  registers: [mqttRegistry],
});

/** Total number of client disconnections since start */
export const mqttDisconnectionsTotal = new Counter({
  name: "mqtt_disconnections_total",
  help: "Total number of client disconnections since start",
  registers: [mqttRegistry],
});

// ─────────────────── Message Metrics ───────────────────

/** Total number of messages published since start */
export const mqttMessagesPublishedTotal = new Counter({
  name: "mqtt_messages_published_total",
  help: "Total number of messages published since start",
  labelNames: ["topic", "qos"],
  registers: [mqttRegistry],
});

/** Total number of messages received since start */
export const mqttMessagesReceivedTotal = new Counter({
  name: "mqtt_messages_received_total",
  help: "Total number of messages received since start",
  labelNames: ["topic", "qos"],
  registers: [mqttRegistry],
});

/** Total number of messages dropped due to size limits */
export const mqttMessagesDroppedTotal = new Counter({
  name: "mqtt_messages_dropped_total",
  help: "Total number of messages dropped due to size limits",
  labelNames: ["reason"],
  registers: [mqttRegistry],
});

// ─────────────────── QoS Metrics ───────────────────

/** Total QoS 0 messages dropped due to soft limit */
export const mqttQos0DroppedTotal = new Counter({
  name: "mqtt_qos0_dropped_total",
  help: "Total QoS 0 messages dropped due to soft limit",
  registers: [mqttRegistry],
});

// ─────────────────── Performance Metrics ───────────────────

/** Message processing latency histogram */
export const mqttMessageLatency = new Histogram({
  name: "mqtt_message_latency_seconds",
  help: "Message processing latency in seconds",
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [mqttRegistry],
});

// ─────────────────── Auth Metrics ───────────────────

/** Total authentication attempts */
export const mqttAuthAttemptsTotal = new Counter({
  name: "mqtt_auth_attempts_total",
  help: "Total authentication attempts",
  labelNames: ["result"],
  registers: [mqttRegistry],
});

/** Total ACL denials */
export const mqttAclDenialsTotal = new Counter({
  name: "mqtt_acl_denials_total",
  help: "Total ACL denials",
  labelNames: ["action", "topic"],
  registers: [mqttRegistry],
});

// ─────���───────────── Session Metrics ───────────────────

/** Active MQTT sessions */
export const mqttActiveSessions = new Gauge({
  name: "mqtt_active_sessions",
  help: "Current number of active MQTT sessions",
  registers: [mqttRegistry],
});

/** Sessions pending expiry */
export const mqttSessionsPendingExpiry = new Gauge({
  name: "mqtt_sessions_pending_expiry",
  help: "Number of sessions pending expiry",
  registers: [mqttRegistry],
});

// ─────────────────── Update Functions ───────────────────

/**
 * 更新连接相关 Prometheus 指标。
 *
 * @param connected - 当前连接客户端数
 * @param connections - 本次新增连接数（累加到 counter）
 * @param disconnections - 本次断开连接数（累加到 counter）
 */
export function updateConnectionMetrics(connected: number, connections: number, disconnections: number): void {
  mqttConnectedClients.set(connected);
  mqttConnectionsTotal.inc(connections);
  mqttDisconnectionsTotal.inc(disconnections);
}

/**
 * 更新消息收发 Prometheus 指标。
 *
 * @param topic - MQTT topic
 * @param qos - QoS 级别（0/1/2）
 * @param direction - 入站或出站方向
 */
export function updateMessageMetrics(
  topic: string,
  qos: 0 | 1 | 2,
  direction: "inbound" | "outbound",
): void {
  const qosLabel = `qos${qos}`;
  if (direction === "inbound") {
    mqttMessagesReceivedTotal.inc({ topic, qos: qosLabel });
  } else {
    mqttMessagesPublishedTotal.inc({ topic, qos: qosLabel });
  }
}

/**
 * 更新因超限丢弃的消息计数。
 *
 * @param reason - 丢弃原因（oversized / qos0_soft_limit / auth）
 */
export function updateDroppedMetrics(reason: "oversized" | "qos0_soft_limit" | "auth"): void {
  mqttMessagesDroppedTotal.inc({ reason });
}

/** 累加 QoS0 软限制丢弃计数。 */
export function updateQos0Dropped(): void {
  mqttQos0DroppedTotal.inc();
}

/**
 * 记录消息处理延迟直方图样本。
 *
 * @param latencyMs - 处理耗时（毫秒）
 */
export function updateMessageLatency(latencyMs: number): void {
  mqttMessageLatency.observe(latencyMs / 1000);
}

/**
 * 累加认证尝试计数。
 *
 * @param success - 认证是否成功
 */
export function updateAuthMetrics(success: boolean): void {
  mqttAuthAttemptsTotal.inc({ result: success ? "success" : "failure" });
}

/**
 * 累加 ACL 拒绝计数。
 *
 * @param action - ACL 动作（publish/subscribe 等）
 * @param topic - 被拒绝的 topic
 */
export function updateAclDenials(action: string, topic: string): void {
  mqttAclDenialsTotal.inc({ action, topic });
}

/**
 * 更新会话相关 Gauge 指标。
 *
 * @param active - 活跃 session 数
 * @param pendingExpiry - 待过期 session 数
 */
export function updateSessionMetrics(active: number, pendingExpiry: number): void {
  mqttActiveSessions.set(active);
  mqttSessionsPendingExpiry.set(pendingExpiry);
}

/**
 * 以 Prometheus 文本格式导出全部指标。
 *
 * @returns Prometheus exposition format 字符串
 */
export async function getMetrics(): Promise<string> {
  return mqttRegistry.metrics();
}

/**
 * 以 JSON 格式导出全部指标。
 *
 * @returns prom-client JSON 指标数组
 */
export async function getMetricsJson(): Promise<unknown> {
  return mqttRegistry.getMetricsAsJSON();
}
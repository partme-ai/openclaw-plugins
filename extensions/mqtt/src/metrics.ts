/**
 * MQTT Prometheus metrics collector
 * Provides comprehensive metrics for monitoring MQTT broker health and performance
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
 * Update connection metrics
 */
export function updateConnectionMetrics(connected: number, connections: number, disconnections: number): void {
  mqttConnectedClients.set(connected);
  mqttConnectionsTotal.inc(connections);
  mqttDisconnectionsTotal.inc(disconnections);
}

/**
 * Update message metrics
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
 * Update dropped message metrics
 */
export function updateDroppedMetrics(reason: "oversized" | "qos0_soft_limit" | "auth"): void {
  mqttMessagesDroppedTotal.inc({ reason });
}

/**
 * Update QoS 0 dropped metrics
 */
export function updateQos0Dropped(): void {
  mqttQos0DroppedTotal.inc();
}

/**
 * Update message latency
 */
export function updateMessageLatency(latencyMs: number): void {
  mqttMessageLatency.observe(latencyMs / 1000);
}

/**
 * Update authentication metrics
 */
export function updateAuthMetrics(success: boolean): void {
  mqttAuthAttemptsTotal.inc({ result: success ? "success" : "failure" });
}

/**
 * Update ACL denial metrics
 */
export function updateAclDenials(action: string, topic: string): void {
  mqttAclDenialsTotal.inc({ action, topic });
}

/**
 * Update session metrics
 */
export function updateSessionMetrics(active: number, pendingExpiry: number): void {
  mqttActiveSessions.set(active);
  mqttSessionsPendingExpiry.set(pendingExpiry);
}

/**
 * Get metrics in Prometheus format
 */
export async function getMetrics(): Promise<string> {
  return mqttRegistry.metrics();
}

/**
 * Get metrics in JSON format
 */
export async function getMetricsJson(): Promise<unknown> {
  return mqttRegistry.getMetricsAsJSON();
}
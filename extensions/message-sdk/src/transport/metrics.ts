/**
 * @module message-sdk/transport/metrics
 *
 * 统一 MQ 渠道 Prometheus 指标工厂 — 连接 / 消息 / 认证 / ACL / 延迟。
 *
 * ⚠️ 可选依赖：需要安装 `prom-client`。未安装时调用 createTransportMetrics 会抛错。
 */

let Registry: typeof import("prom-client").Registry;
let Counter: typeof import("prom-client").Counter;
let Gauge: typeof import("prom-client").Gauge;
let Histogram: typeof import("prom-client").Histogram;
let collectDefaultMetrics: typeof import("prom-client").collectDefaultMetrics;

try {
  const promClient = await import("prom-client");
  Registry = promClient.Registry;
  Counter = promClient.Counter;
  Gauge = promClient.Gauge;
  Histogram = promClient.Histogram;
  collectDefaultMetrics = promClient.collectDefaultMetrics;
} catch {
  // prom-client is optional; createTransportMetrics will throw if called without it.
}

// ──────────────────── 类型 ────────────────────

export interface TransportMetrics {
  registry: unknown;
  getMetrics(): Promise<string>;
  getMetricsJson(): Promise<unknown>;
  setConnectedClients(n: number): void;
  incConnections(n?: number): void;
  incDisconnections(n?: number): void;
  incMessagesPublished(labels: { topic: string; qos: string }): void;
  incMessagesReceived(labels: { topic: string; qos: string }): void;
  incMessagesDropped(labels: { reason: string }): void;
  observeMessageLatency(ms: number): void;
  incAuthAttempts(success: boolean): void;
  incAclDenials(labels: { action: string; topic: string }): void;
  setActiveSessions(n: number): void;
  setSessionsPendingExpiry(n: number): void;
}

export interface TransportMetricsOptions {
  prefix: string;
}

// ──────────────────── 工厂 ────────────────────

/**
 * 为指定渠道创建一套标准化的 Prometheus 指标。
 *
 * ⚠️ 需要 `prom-client` 已安装，否则抛错。
 */
export function createTransportMetrics(opts: TransportMetricsOptions): TransportMetrics {
  if (!Registry) {
    throw new Error(
      "prom-client is required for createTransportMetrics. Install it with: pnpm add prom-client",
    );
  }

  const { prefix } = opts;
  const registry = new Registry();

  collectDefaultMetrics!({ register: registry, prefix });

  const connectedClients = new Gauge!({
    name: `${prefix}connected_clients`,
    help: "Current number of connected clients",
    registers: [registry],
  });
  const connectionsTotal = new Counter!({
    name: `${prefix}connections_total`,
    help: "Total connections since start",
    registers: [registry],
  });
  const disconnectionsTotal = new Counter!({
    name: `${prefix}disconnections_total`,
    help: "Total disconnections since start",
    registers: [registry],
  });

  const messagesPublished = new Counter!({
    name: `${prefix}messages_published_total`,
    help: "Total messages published since start",
    labelNames: ["topic", "qos"],
    registers: [registry],
  });
  const messagesReceived = new Counter!({
    name: `${prefix}messages_received_total`,
    help: "Total messages received since start",
    labelNames: ["topic", "qos"],
    registers: [registry],
  });
  const messagesDropped = new Counter!({
    name: `${prefix}messages_dropped_total`,
    help: "Total messages dropped",
    labelNames: ["reason"],
    registers: [registry],
  });

  const messageLatency = new Histogram!({
    name: `${prefix}message_latency_seconds`,
    help: "Message processing latency in seconds",
    buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry],
  });

  const authAttempts = new Counter!({
    name: `${prefix}auth_attempts_total`,
    help: "Total authentication attempts",
    labelNames: ["result"],
    registers: [registry],
  });

  const aclDenials = new Counter!({
    name: `${prefix}acl_denials_total`,
    help: "Total ACL denials",
    labelNames: ["action", "topic"],
    registers: [registry],
  });

  const activeSessions = new Gauge!({
    name: `${prefix}active_sessions`,
    help: "Current active sessions",
    registers: [registry],
  });
  const sessionsPendingExpiry = new Gauge!({
    name: `${prefix}sessions_pending_expiry`,
    help: "Sessions pending expiry",
    registers: [registry],
  });

  return {
    registry,
    getMetrics: () => registry.metrics(),
    getMetricsJson: () => registry.getMetricsAsJSON(),
    setConnectedClients: (n) => connectedClients.set(n),
    incConnections: (n = 1) => connectionsTotal.inc(n),
    incDisconnections: (n = 1) => disconnectionsTotal.inc(n),
    incMessagesPublished: (l) => messagesPublished.inc(l),
    incMessagesReceived: (l) => messagesReceived.inc(l),
    incMessagesDropped: (l) => messagesDropped.inc(l),
    observeMessageLatency: (ms) => messageLatency.observe(ms / 1000),
    incAuthAttempts: (success) => authAttempts.inc({ result: success ? "success" : "failure" }),
    incAclDenials: (l) => aclDenials.inc(l),
    setActiveSessions: (n) => activeSessions.set(n),
    setSessionsPendingExpiry: (n) => sessionsPendingExpiry.set(n),
  };
}

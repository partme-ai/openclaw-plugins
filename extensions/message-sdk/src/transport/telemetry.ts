/** Bounded O6 facts transported through the public OpenClaw diagnostics bus. */
import { createHash } from "node:crypto";
import { emitDiagnosticEvent } from "openclaw/plugin-sdk/diagnostic-runtime";

export const TELEMETRY_LOGGER = "partme.delivery-recall.v1";
const CHANNELS = new Set(["mqtt", "rabbitmq", "redis-stream", "rocketmq", "stomp", "web-mqtt", "web-stomp", "router"]);

function identity(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return `id_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export type DeliveryTelemetry = {
  event: "started" | "settlement" | "retry" | "dlq";
  channel: string;
  outcome?: "delivered" | "failed" | "ambiguous";
  entries?: number;
  runId?: string;
  messageId?: string;
  deliveryId?: string;
};

/** Emit only fixed facts and pseudonymous identities; never include a message body or credential. */
export function emitDeliveryTelemetry(fact: DeliveryTelemetry): void {
  const channel = CHANNELS.has(fact.channel) ? fact.channel : "other";
  if (fact.event === "settlement" && !fact.outcome) return;
  if (fact.event === "dlq" && (!Number.isInteger(fact.entries) || fact.entries! < 0 || fact.entries! > 1_000_000)) return;
  try { emitDiagnosticEvent({ type: "log.record", level: "info", loggerName: TELEMETRY_LOGGER,
    message: "delivery telemetry", attributes: {
      event: fact.event, channel,
      ...(fact.outcome ? { outcome: fact.outcome } : {}),
      ...(fact.event === "dlq" ? { entries: fact.entries! } : {}),
      ...(identity(fact.runId) ? { run_id: identity(fact.runId)! } : {}),
      ...(identity(fact.messageId) ? { message_id: identity(fact.messageId)! } : {}),
      ...(identity(fact.deliveryId) ? { delivery_id: identity(fact.deliveryId)! } : {}),
    } }); } catch { /* Observation must never change broker settlement. */ }
}

/** Record a completed memory search, including failed/cancelled searches, without query content. */
export function emitRecallTelemetry(fact: { plugin: "memory" | "openmem"; durationMs: number }): void {
  if (!Number.isFinite(fact.durationMs) || fact.durationMs < 0) return;
  try { emitDiagnosticEvent({ type: "log.record", level: "info", loggerName: TELEMETRY_LOGGER,
    message: "recall telemetry", attributes: { event: "recall", plugin: fact.plugin,
      duration_ms: Math.min(fact.durationMs, 600_000) } }); } catch { /* Preserve the search result. */ }
}

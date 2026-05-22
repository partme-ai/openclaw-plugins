/**
 * MQTT 审计日志工具。
 * 支持按配置输出结构化 JSON，便于接入 ELK / Loki / SIEM。
 */

import type { MqttAuditConfig } from "../types.js";
import { randomUUID } from "node:crypto";

type AuditLevel = "info" | "warn" | "error";

/**
 * 输出审计日志事件。
 */
export function logAuditEvent(
  audit: MqttAuditConfig | undefined,
  level: AuditLevel,
  event: string,
  details: Record<string, unknown>,
): void {
  if (!audit?.enabled) return;
  const payload = {
    eventId: randomUUID(),
    ts: new Date().toISOString(),
    level,
    event,
    component: "openclaw-mqtt",
    ...details,
  };
  if (audit.format === "text") {
    console.log(`[openclaw-mqtt-audit] ${event} ${JSON.stringify(details)}`);
    return;
  }
  console.log(JSON.stringify(payload));
}


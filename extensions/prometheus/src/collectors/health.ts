import type { MetricCollector, MetricDefinition, MetricSample, HealthSnapshot } from "../types.js";
import { rpcCall } from "../runtime/ws-bridge.js";

const GATEWAY_PREFIX = "openclaw_gateway";

export class HealthCollector implements MetricCollector {
  name = "health";

  definitions: MetricDefinition[] = [
    { name: `${GATEWAY_PREFIX}_up`, help: "Gateway health status (1=ok, 0=error)", type: "gauge" },
    { name: `${GATEWAY_PREFIX}_health_check_duration_seconds`, help: "Gateway health check probe duration in seconds", type: "gauge" },
    { name: `${GATEWAY_PREFIX}_uptime_seconds`, help: "Gateway uptime in seconds", type: "gauge" },
    { name: `${GATEWAY_PREFIX}_heartbeat_interval_seconds`, help: "Gateway heartbeat interval (seconds)", type: "gauge" },
    { name: `${GATEWAY_PREFIX}_agents_configured_total`, help: "Number of configured agents", type: "gauge" },
  ];

  async collect(): Promise<MetricSample[]> {
    const samples: MetricSample[] = [];
    const health = await rpcCall<HealthSnapshot>("health");

    samples.push({ name: `${GATEWAY_PREFIX}_up`, value: health.ok ? 1 : 0 });
    samples.push({ name: `${GATEWAY_PREFIX}_health_check_duration_seconds`, value: (health.durationMs ?? 0) / 1000 });
    samples.push({ name: `${GATEWAY_PREFIX}_uptime_seconds`, value: health.uptimeSeconds ?? process.uptime() });
    samples.push({ name: `${GATEWAY_PREFIX}_heartbeat_interval_seconds`, value: health.heartbeatSeconds ?? 0 });

    const agentCount = Array.isArray(health.agents) ? health.agents.length : 0;
    samples.push({ name: `${GATEWAY_PREFIX}_agents_configured_total`, value: agentCount });

    return samples;
  }
}

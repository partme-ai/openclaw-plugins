import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpcCall } = vi.hoisted(() => ({ rpcCall: vi.fn() }));

vi.mock("../src/runtime/ws-bridge.js", () => ({ rpcCall }));

import { HealthCollector } from "../src/collectors/health.js";

describe("HealthCollector", () => {
  beforeEach(() => {
    rpcCall.mockReset();
  });

  it("maps the OpenClaw health RPC snapshot to low-cardinality metrics", async () => {
    rpcCall.mockResolvedValue({
      ok: true,
      durationMs: 250,
      uptimeSeconds: 42,
      heartbeatSeconds: 30,
      agents: [{ id: "main" }, { id: "support" }],
    });

    const samples = await new HealthCollector().collect();

    expect(rpcCall).toHaveBeenCalledWith("health");
    expect(samples).toEqual([
      { name: "openclaw_gateway_up", value: 1 },
      { name: "openclaw_gateway_health_check_duration_seconds", value: 0.25 },
      { name: "openclaw_gateway_uptime_seconds", value: 42 },
      { name: "openclaw_gateway_heartbeat_interval_seconds", value: 30 },
      { name: "openclaw_gateway_agents_configured_total", value: 2 },
    ]);
  });

  it("reports an unhealthy snapshot without swallowing RPC failures", async () => {
    rpcCall.mockResolvedValue({ ok: false, agents: [] });
    await expect(new HealthCollector().collect()).resolves.toEqual(
      expect.arrayContaining([{ name: "openclaw_gateway_up", value: 0 }]),
    );

    rpcCall.mockRejectedValue(new Error("gateway unavailable"));
    await expect(new HealthCollector().collect()).rejects.toThrow(
      "gateway unavailable",
    );
  });
});

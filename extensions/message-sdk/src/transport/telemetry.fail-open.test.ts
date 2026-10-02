import { describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/diagnostic-runtime", () => ({
  emitDiagnosticEvent: () => { throw new Error("telemetry down"); },
}));

import { emitDeliveryTelemetry, emitRecallTelemetry } from "./telemetry.js";

describe("telemetry failure isolation", () => {
  it("does not alter delivery settlement or recall when the host emitter throws", () => {
    expect(() => emitDeliveryTelemetry({ event: "settlement", channel: "mqtt", outcome: "delivered" })).not.toThrow();
    expect(() => emitRecallTelemetry({ plugin: "memory", durationMs: 10 })).not.toThrow();
  });
});

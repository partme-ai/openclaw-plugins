import { describe, expect, it } from "vitest";
import { onInternalDiagnosticEvent, waitForDiagnosticEventsDrained } from "openclaw/plugin-sdk/diagnostic-runtime";
import { emitDeliveryTelemetry, emitRecallTelemetry } from "./telemetry.js";

describe("O6 cross-package diagnostic contract", () => {
  it("publishes bounded redacted facts through the host bus and unsubscribes", async () => {
    const received: unknown[] = [];
    const stop = onInternalDiagnosticEvent((event) => received.push(event));
    emitDeliveryTelemetry({ event: "settlement", channel: "mqtt", outcome: "delivered",
      runId: "run-secret", messageId: "message-secret", deliveryId: "delivery-secret" });
    emitRecallTelemetry({ plugin: "memory", durationMs: 250 });
    await waitForDiagnosticEventsDrained();
    expect(received).toHaveLength(2);
    expect(JSON.stringify(received)).not.toMatch(/run-secret|message-secret|delivery-secret/);
    stop();
    emitDeliveryTelemetry({ event: "retry", channel: "mqtt", deliveryId: "another" });
    await waitForDiagnosticEventsDrained();
    expect(received).toHaveLength(2);
  });

});

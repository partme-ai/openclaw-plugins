import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBundledDiagnosticsPrometheusEnabled,
  resetDiagnosticsMetricStore,
  startDiagnosticsSubscription,
} from "./subscribe.js";

describe("isBundledDiagnosticsPrometheusEnabled", () => {
  it("returns false when config is missing or entry absent", () => {
    expect(isBundledDiagnosticsPrometheusEnabled(undefined)).toBe(false);
    expect(isBundledDiagnosticsPrometheusEnabled({})).toBe(false);
    expect(isBundledDiagnosticsPrometheusEnabled({ plugins: { entries: {} } })).toBe(false);
  });

  it("returns false when diagnostics-prometheus is explicitly disabled", () => {
    expect(
      isBundledDiagnosticsPrometheusEnabled({
        plugins: { entries: { "diagnostics-prometheus": { enabled: false } } },
      }),
    ).toBe(false);
  });

  it("returns true when diagnostics-prometheus entry is enabled or not explicitly disabled", () => {
    expect(
      isBundledDiagnosticsPrometheusEnabled({
        plugins: { entries: { "diagnostics-prometheus": { enabled: true } } },
      }),
    ).toBe(true);
    expect(
      isBundledDiagnosticsPrometheusEnabled({
        plugins: { entries: { "diagnostics-prometheus": {} } },
      }),
    ).toBe(true);
    expect(
      isBundledDiagnosticsPrometheusEnabled({
        plugins: { entries: { "diagnostics-prometheus": true } },
      }),
    ).toBe(true);
  });
});

describe("startDiagnosticsSubscription duplicate exporter warn", () => {
  afterEach(() => {
    resetDiagnosticsMetricStore();
  });

  it("warns when subscription succeeds and bundled diagnostics-prometheus is enabled", async () => {
    const warn = vi.fn();
    const info = vi.fn();
    const unsubscribeMock = vi.fn();

    await startDiagnosticsSubscription({
      logger: { info, warn, error: vi.fn() },
      internalDiagnostics: {
        emit: vi.fn(),
        onEvent: () => unsubscribeMock,
      },
      config: {
        plugins: { entries: { "diagnostics-prometheus": { enabled: true } } },
      },
    });

    expect(info).toHaveBeenCalledWith(
      "openclaw-prometheus: subscribed via internalDiagnostics.onEvent",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("bundled diagnostics-prometheus is also enabled"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('plugins.entries["diagnostics-prometheus"].enabled to false'),
    );
  });

  it("does not warn when bundled diagnostics-prometheus is disabled", async () => {
    const warn = vi.fn();

    await startDiagnosticsSubscription({
      logger: { info: vi.fn(), warn, error: vi.fn() },
      internalDiagnostics: {
        emit: vi.fn(),
        onEvent: () => vi.fn(),
      },
      config: {
        plugins: { entries: { "diagnostics-prometheus": { enabled: false } } },
      },
    });

    expect(warn).not.toHaveBeenCalled();
  });
});

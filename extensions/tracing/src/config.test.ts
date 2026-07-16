import { describe, expect, it } from "vitest";
import { normalizeOtlpEndpoint, normalizeTracingConfig } from "./config.js";

describe("normalizeTracingConfig", () => {
  it("插件配置覆盖旧版全局配置", () => {
    const config = normalizeTracingConfig(
      { enabled: false, sampleRate: 0.1 },
      { enabled: true, sampleRate: 0.5, backend: "otlp" },
    );
    expect(config.enabled).toBe(true);
    expect(config.sampleRate).toBe(0.5);
    expect(config.backend).toBe("otlp");
    expect(config.maxBufferedSpans).toBe(10_000);
  });

  it.each([
    [{ sampleRate: 1.1 }, "sampleRate"],
    [{ maxSpansPerTrace: 0 }, "maxSpansPerTrace"],
    [{ maxBufferedSpans: 1.5 }, "maxBufferedSpans"],
    [{ backend: "skywalking" }, "backend"],
    [{ otlpEndpoint: "file:///tmp/traces" }, "http or https"],
  ])("拒绝非法配置 %j", (input, expected) => {
    expect(() => normalizeTracingConfig(undefined, input)).toThrow(expected as string);
  });
});

describe("normalizeOtlpEndpoint", () => {
  it("collector 基址会补全 trace 路径", () => {
    expect(normalizeOtlpEndpoint("http://localhost:4318")).toBe("http://localhost:4318/v1/traces");
  });

  it("完整路径不会重复拼接", () => {
    expect(normalizeOtlpEndpoint("https://collector.example/v1/traces/"))
      .toBe("https://collector.example/v1/traces");
  });
});

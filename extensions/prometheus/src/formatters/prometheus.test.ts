/**
 * Prometheus 格式化器单元测试
 *
 * 测试覆盖：
 * - HELP / TYPE 行生成
 * - 指标样本格式化（含 labels）
 * - Label 值转义（\, ", \n）
 * - 未定义指标的自动发现
 * - 按定义顺序输出
 */

import { describe, it, expect } from "vitest";
import { formatPrometheus } from "./prometheus.js";
import type { MetricDefinition, MetricSample } from "../types.js";

describe("formatPrometheus", () => {
  it("应生成 HELP 和 TYPE 行", () => {
    const definitions: MetricDefinition[] = [
      { name: "openclaw_sessions_total", help: "Total sessions", type: "counter" },
    ];
    const samples: MetricSample[] = [
      { name: "openclaw_sessions_total", value: 42 },
    ];

    const output = formatPrometheus(definitions, samples);
    expect(output).toContain("# HELP openclaw_sessions_total Total sessions");
    expect(output).toContain("# TYPE openclaw_sessions_total counter");
    expect(output).toContain("openclaw_sessions_total 42");
  });

  it("应正确格式化带 labels 的样本", () => {
    const definitions: MetricDefinition[] = [
      { name: "openclaw_agent_messages", help: "Agent messages", type: "gauge" },
    ];
    const samples: MetricSample[] = [
      { name: "openclaw_agent_messages", value: 100, labels: { agent_id: "sales-bot", channel: "wecom-kf" } },
    ];

    const output = formatPrometheus(definitions, samples);
    expect(output).toContain('openclaw_agent_messages{agent_id="sales-bot",channel="wecom-kf"} 100');
  });

  it("应转义 label 值中的特殊字符", () => {
    const definitions: MetricDefinition[] = [];
    const samples: MetricSample[] = [
      { name: "test_metric", value: 1, labels: { msg: 'hello "world"\nfoo' } },
    ];

    const output = formatPrometheus(definitions, samples);
    expect(output).toContain('msg="hello \\"world\\"\\nfoo"');
  });

  it("应为未定义的指标生成 auto-discovered 标记", () => {
    const definitions: MetricDefinition[] = [];
    const samples: MetricSample[] = [
      { name: "unknown_metric", value: 99 },
    ];

    const output = formatPrometheus(definitions, samples);
    expect(output).toContain("# HELP unknown_metric (auto-discovered)");
    expect(output).toContain("# TYPE unknown_metric gauge");
    expect(output).toContain("unknown_metric 99");
  });

  it("应包含 timestamp（如果提供）", () => {
    const definitions: MetricDefinition[] = [];
    const samples: MetricSample[] = [
      { name: "ts_metric", value: 10, timestamp: 1700000000000 },
    ];

    const output = formatPrometheus(definitions, samples);
    expect(output).toContain("ts_metric 10 1700000000000");
  });

  it("空输入应返回空字符串", () => {
    const output = formatPrometheus([], []);
    expect(output.trim()).toBe("");
  });

  it("同名指标的多个样本应聚合在同一 HELP/TYPE 下", () => {
    const definitions: MetricDefinition[] = [
      { name: "http_requests", help: "HTTP request count", type: "counter" },
    ];
    const samples: MetricSample[] = [
      { name: "http_requests", value: 10, labels: { method: "GET" } },
      { name: "http_requests", value: 5, labels: { method: "POST" } },
    ];

    const output = formatPrometheus(definitions, samples);
    const lines = output.split("\n");
    const helpCount = lines.filter((l) => l.includes("# HELP http_requests")).length;
    expect(helpCount).toBe(1); // 只应有一个 HELP 行
  });
});

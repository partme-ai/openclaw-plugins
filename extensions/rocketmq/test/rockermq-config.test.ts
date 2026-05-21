/**
 * RocketMQ 配置解析与验证测试。
 */

import { describe, it, expect } from "vitest";
import {
  resolveRockermqConfig,
  validateRockermqConfig,
  buildRockermqConfigSnapshot,
  DEFAULT_ROCKERMQ_CONFIG,
} from "../src/rocketmq-config.js";

describe("rocketmq-config", () => {
  describe("resolveRockermqConfig", () => {
    it("should use defaults when no config provided", () => {
      const result = resolveRockermqConfig({});
      expect(result).toEqual(DEFAULT_ROCKERMQ_CONFIG);
    });

    it("should parse endpoints from runtime config", () => {
      const result = resolveRockermqConfig({
        channels: { rocketmq: { endpoints: "10.0.0.1:8081" } },
      });
      expect(result.endpoints).toBe("10.0.0.1:8081");
    });

    it("should parse topicPrefix from runtime config", () => {
      const result = resolveRockermqConfig({
        channels: { rocketmq: { topicPrefix: "custom" } },
      });
      expect(result.topicPrefix).toBe("custom");
    });

    it("should parse topic bindings", () => {
      const result = resolveRockermqConfig({
        channels: {
          rocketmq: {
            topicBindings: [
              { topic: "device.status", tag: "iot", agentId: "agent1", accountId: "acc1" },
              { topic: "sensor.data", tag: "*", agentId: "agent2" },
            ],
          },
        },
      });
      expect(result.topicBindings).toHaveLength(2);
      expect(result.topicBindings[0].topic).toBe("device.status");
      expect(result.topicBindings[0].agentId).toBe("agent1");
      expect(result.topicBindings[0].accountId).toBe("acc1");
      expect(result.topicBindings[1].accountId).toBe("default");
    });

    it("should parse consumer subscriptions", () => {
      const result = resolveRockermqConfig({
        channels: {
          rocketmq: {
            consumer: {
              subscriptions: [
                { topic: "topic1", filterExpression: "*" },
                { topic: "topic2", filterExpression: "tagA" },
              ],
            },
          },
        },
      });
      expect(result.consumer.subscriptions).toHaveLength(2);
      expect(result.consumer.subscriptions[0].topic).toBe("topic1");
      expect(result.consumer.subscriptions[1].filterExpression).toBe("tagA");
    });

    it("should parse payload mode", () => {
      const result = resolveRockermqConfig({
        channels: { rocketmq: { payload: { mode: "jsonOnly" } } },
      });
      expect(result.payload.mode).toBe("jsonOnly");
    });

    it("should handle missing nested config gracefully", () => {
      const result = resolveRockermqConfig({ channels: { rocketmq: null as any } });
      expect(result.endpoints).toBe(DEFAULT_ROCKERMQ_CONFIG.endpoints);
    });

    it("should handle undefined rocketmq config", () => {
      const result = resolveRockermqConfig({});
      expect(result.endpoints).toBe(DEFAULT_ROCKERMQ_CONFIG.endpoints);
    });

    it("should parse dispatch mode", () => {
      const result = resolveRockermqConfig({
        channels: { rocketmq: { dispatch: { mode: "subagent" } } },
      });
      expect(result.dispatch.mode).toBe("subagent");
    });

    it("should parse idempotency config", () => {
      const result = resolveRockermqConfig({
        channels: { rocketmq: { idempotency: { enabled: true, ttlMs: 10000, maxEntries: 100 } } },
      });
      expect(result.idempotency.enabled).toBe(true);
      expect(result.idempotency.ttlMs).toBe(10000);
      expect(result.idempotency.maxEntries).toBe(100);
    });

    it("should filter out bindings with empty topic or agentId", () => {
      const result = resolveRockermqConfig({
        channels: {
          rocketmq: {
            topicBindings: [
              { topic: "", tag: "*", agentId: "agent1" },
              { topic: "valid.topic", tag: "*", agentId: "" },
              { topic: "valid.topic", tag: "*", agentId: "agent2" },
            ],
          },
        },
      });
      expect(result.topicBindings).toHaveLength(1);
      expect(result.topicBindings[0].topic).toBe("valid.topic");
      expect(result.topicBindings[0].agentId).toBe("agent2");
    });
  });

  describe("validateRockermqConfig", () => {
    it("should return empty array for valid config", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        endpoints: "127.0.0.1:8081",
        topicPrefix: "openclaw",
        topicBindings: [
          { topic: "device.status", tag: "iot", agentId: "agent1", accountId: "default" },
        ],
      };
      const issues = validateRockermqConfig(config);
      expect(issues).toHaveLength(0);
    });

    it("should report missing endpoints", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        endpoints: "",
      };
      const issues = validateRockermqConfig(config);
      expect(issues).toContain("RocketMQ endpoints is required");
    });

    it("should report missing producer groupId", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        producer: { ...DEFAULT_ROCKERMQ_CONFIG.producer, groupId: "" },
      };
      const issues = validateRockermqConfig(config);
      expect(issues).toContain("RocketMQ producer.groupId is required");
    });

    it("should report missing consumer groupId", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        consumer: { ...DEFAULT_ROCKERMQ_CONFIG.consumer, groupId: "" },
      };
      const issues = validateRockermqConfig(config);
      expect(issues).toContain("RocketMQ consumer.groupId is required");
    });
  });

  describe("buildRockermqConfigSnapshot", () => {
    it("should mask session credentials", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        endpoints: "127.0.0.1:8081",
        sessionCredentials: {
          accessKey: "ak",
          accessSecret: "secret",
          securityToken: "token",
        },
      };
      const snapshot = buildRockermqConfigSnapshot(config);
      expect((snapshot.sessionCredentials as any).accessSecret).toBe("***");
      expect((snapshot.sessionCredentials as any).securityToken).toBe("***");
    });

    it("should not add sessionCredentials when absent", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
      };
      const snapshot = buildRockermqConfigSnapshot(config);
      expect(snapshot.sessionCredentials).toBeUndefined();
    });
  });
});

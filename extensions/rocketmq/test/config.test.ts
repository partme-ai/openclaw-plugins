/**
 * RocketMQ 配置解析与验证测试。
 */

import { describe, it, expect } from "vitest";
import {
  resolveRockermqConfig,
  validateRockermqConfig,
  buildRockermqConfigSnapshot,
  DEFAULT_ROCKERMQ_CONFIG,
} from "../src/config.js";

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
              {
                topic: "device.status",
                tag: "iot",
                agentId: "agent1",
                accountId: "acc1",
              },
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
      const result = resolveRockermqConfig({
        channels: { rocketmq: null as any },
      });
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
        channels: {
          rocketmq: {
            idempotency: { enabled: true, ttlMs: 10000, maxEntries: 100 },
          },
        },
      });
      expect(result.idempotency.enabled).toBe(true);
      expect(result.idempotency.ttlMs).toBe(10000);
      expect(result.idempotency.maxEntries).toBe(100);
    });

    it("should enable claimable idempotency and bounded startup retries by default", () => {
      const result = resolveRockermqConfig({});
      expect(result.idempotency.enabled).toBe(true);
      expect(result.producer.maxAttempts).toBe(3);
      expect(result.connection).toEqual({
        startupAttempts: 6,
        retryDelayMs: 5000,
        retryMaxDelayMs: 60_000,
        retryJitterRatio: 0.2,
        shutdownTimeoutMs: 10_000,
      });
    });

    it("should parse producer and connection retry settings", () => {
      const result = resolveRockermqConfig({
        channels: {
          rocketmq: {
            producer: { maxAttempts: 5 },
            connection: {
              startupAttempts: 9,
              retryDelayMs: 250,
              retryMaxDelayMs: 10_000,
              retryJitterRatio: 0.1,
              shutdownTimeoutMs: 2500,
            },
          },
        },
      });
      expect(result.producer.maxAttempts).toBe(5);
      expect(result.connection).toEqual({
        startupAttempts: 9,
        retryDelayMs: 250,
        retryMaxDelayMs: 10_000,
        retryJitterRatio: 0.1,
        shutdownTimeoutMs: 2500,
      });
    });

    it("should parse the consumer retry and DLQ threshold", () => {
      const result = resolveRockermqConfig({
        channels: {
          rocketmq: {
            consumer: {
              retry: {
                maxAttempts: 5,
                initialDelayMs: 2000,
                maxDelayMs: 30000,
                multiplier: 1.5,
              },
            },
          },
        },
      });
      expect(result.consumer.retry).toEqual({
        maxAttempts: 5,
        initialDelayMs: 2000,
        maxDelayMs: 30000,
        multiplier: 1.5,
      });
    });

    it("should preserve invalid bindings so startup validation can fail explicitly", () => {
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
      expect(result.topicBindings).toHaveLength(3);
      expect(validateRockermqConfig(result)).toEqual(
        expect.arrayContaining([
          "RocketMQ topic binding is invalid: ",
          "RocketMQ topic binding agentId is required for topic: valid.topic",
          "RocketMQ topic binding is duplicated: valid.topic#*",
        ]),
      );
    });

    it("should not silently replace explicit invalid numeric and enum values", () => {
      const result = resolveRockermqConfig({
        channels: {
          rocketmq: {
            producer: { maxAttempts: 0 },
            payload: { mode: "yaml" },
            dispatch: { mode: "unknown" },
            connection: { retryJitterRatio: 2 },
          },
        },
      });

      expect(validateRockermqConfig(result)).toEqual(
        expect.arrayContaining([
          "RocketMQ producer.maxAttempts must be a positive safe integer",
          "RocketMQ payload.mode is invalid: yaml",
          "RocketMQ dispatch.mode is invalid: unknown",
          "RocketMQ connection.retryJitterRatio must be between 0 and 1",
        ]),
      );
    });

    it("should reject partial ACL credentials instead of falling back to anonymous access", () => {
      const result = resolveRockermqConfig({
        channels: {
          rocketmq: { sessionCredentials: { accessKey: "only-ak" } },
        },
      });
      expect(validateRockermqConfig(result)).toContain(
        "RocketMQ sessionCredentials requires both accessKey and accessSecret",
      );
    });
  });

  describe("validateRockermqConfig", () => {
    it("should return empty array for valid config", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        endpoints: "127.0.0.1:8081",
        topicPrefix: "openclaw",
        topicBindings: [
          {
            topic: "device-status",
            tag: "iot",
            agentId: "agent1",
            accountId: "default",
          },
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

    it("should report missing consumer groupId", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        consumer: { ...DEFAULT_ROCKERMQ_CONFIG.consumer, groupId: "" },
      };
      const issues = validateRockermqConfig(config);
      expect(issues).toContain("RocketMQ consumer.groupId is required");
    });

    it("should reject broker resource names containing unsupported separators", () => {
      const config = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        topicBindings: [
          {
            topic: "device.status",
            tag: "*",
            agentId: "agent1",
            accountId: "default",
            replyTopic: "device.status.out",
          },
        ],
      };
      expect(validateRockermqConfig(config)).toEqual([
        "RocketMQ topic binding is invalid: device.status",
        "RocketMQ reply topic is invalid: device.status.out",
      ]);
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
      expect((snapshot.sessionCredentials as any).accessKey).toBe("***");
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

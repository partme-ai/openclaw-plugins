/**
 * RocketMQ Topic 路由测试。
 */

import { describe, it, expect } from "vitest";
import {
  parseStandardTopic,
  resolveInboundRoute,
  matchTopic,
  buildReplyTopicFromInbound,
  buildOutboundTopic,
} from "../src/topic-router.js";
import { DEFAULT_ROCKERMQ_CONFIG, type RockermqConfig } from "../src/rocketmq-config.js";

describe("topic-router", () => {
  describe("parseStandardTopic", () => {
    it("should parse standard inbound topic", () => {
      const result = parseStandardTopic("openclaw.agent.agent1.in", "openclaw");
      expect(result).toEqual({ agentId: "agent1", peerId: "", direction: "in" });
    });

    it("should parse standard outbound topic", () => {
      const result = parseStandardTopic("openclaw.agent.agent1.out", "openclaw");
      expect(result).toEqual({ agentId: "agent1", peerId: "", direction: "out" });
    });

    it("should parse topic with peer id", () => {
      const result = parseStandardTopic("openclaw.agent.agent1.in.device123", "openclaw");
      expect(result).toEqual({ agentId: "agent1", peerId: "device123", direction: "in" });
    });

    it("should parse multi-segment peer id", () => {
      const result = parseStandardTopic("openclaw.agent.agent1.in.device123.sensor", "openclaw");
      expect(result).toEqual({ agentId: "agent1", peerId: "device123.sensor", direction: "in" });
    });

    it("should return null for non-matching prefix", () => {
      const result = parseStandardTopic("wrong.agent.agent1.in", "openclaw");
      expect(result).toBeNull();
    });

    it("should return null for invalid format", () => {
      const result = parseStandardTopic("openclaw.invalid", "openclaw");
      expect(result).toBeNull();
    });

    it("should return null for non-agent prefix", () => {
      const result = parseStandardTopic("openclaw.user.agent1.in", "openclaw");
      expect(result).toBeNull();
    });

    it("should return null for invalid direction", () => {
      const result = parseStandardTopic("openclaw.agent.agent1.status", "openclaw");
      expect(result).toBeNull();
    });

    it("should handle custom topic prefix", () => {
      const result = parseStandardTopic("custom.agent.agent1.in", "custom");
      expect(result).toEqual({ agentId: "agent1", peerId: "", direction: "in" });
    });

    it("should handle empty topic prefix", () => {
      const result = parseStandardTopic("agent.agent1.in", "");
      expect(result).toEqual({ agentId: "agent1", peerId: "", direction: "in" });
    });
  });

  describe("matchTopic", () => {
    it("should match exact topic", () => {
      expect(matchTopic("device.data", "device.data")).toBe(true);
    });

    it("should match single-level wildcard", () => {
      expect(matchTopic("device.data", "device.*")).toBe(true);
      expect(matchTopic("device.temp", "device.*")).toBe(true);
    });

    it("should not match wrong single-level wildcard", () => {
      expect(matchTopic("device.data.humidity", "device.*")).toBe(false);
    });

    it("should match multi-level wildcard", () => {
      expect(matchTopic("device.data", "device.#")).toBe(true);
      expect(matchTopic("device.data.humidity", "device.#")).toBe(true);
      expect(matchTopic("device.data.temp.humidity", "device.#")).toBe(true);
    });

    it("should handle multiple wildcards", () => {
      expect(matchTopic("a.b.c", "*.#")).toBe(true);
    });

    it("should not match when pattern is longer", () => {
      expect(matchTopic("device", "device.data")).toBe(false);
    });

    it("should match with numeric topic part", () => {
      expect(matchTopic("device.123", "device.*")).toBe(true);
    });

    it("should treat + as single-level wildcard", () => {
      expect(matchTopic("device.123", "device.+")).toBe(true);
    });

    it("should normalize / separators for compatibility", () => {
      expect(matchTopic("devices/123/in", "devices/+/in")).toBe(true);
      expect(matchTopic("devices/123/in", "devices/*/in")).toBe(true);
    });
  });

  describe("resolveInboundRoute", () => {
    const config: RockermqConfig = {
      ...DEFAULT_ROCKERMQ_CONFIG,
      endpoints: "127.0.0.1:8081",
      topicPrefix: "openclaw",
      topicBindings: [
        { topic: "sensor.data", tag: "iot", agentId: "sensor-agent", accountId: "sensor-acc" },
      ],
    };

    it("should resolve explicit binding first", () => {
      const result = resolveInboundRoute("sensor.data", "iot", config);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.agentId).toBe("sensor-agent");
        expect(result.accountId).toBe("sensor-acc");
        expect(result.source).toBe("binding");
      }
    });

    it("should resolve standard format as fallback", () => {
      const result = resolveInboundRoute("openclaw.agent.test-agent.in", undefined, config);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.agentId).toBe("test-agent");
        expect(result.source).toBe("standard");
      }
    });

    it("should return null for unmatched topic", () => {
      const result = resolveInboundRoute("unknown.topic", undefined, config);
      expect(result).toBeNull();
    });

    it("should extract peer id from topic", () => {
      const result = resolveInboundRoute("openclaw.agent.agent1.in.device123", undefined, config);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.peerId).toBe("device123");
      }
    });

    it("should not match binding with wrong tag", () => {
      const result = resolveInboundRoute("sensor.data", "wrong-tag", config);
      expect(result).toBeNull();
    });

    it("should match binding with wildcard tag", () => {
      const wildcardConfig: RockermqConfig = {
        ...DEFAULT_ROCKERMQ_CONFIG,
        topicBindings: [
          { topic: "device.status", tag: "*", agentId: "device-agent", accountId: "default" },
        ],
      };
      const result = resolveInboundRoute("device.status", "any-tag", wildcardConfig);
      expect(result).not.toBeNull();
      if (result) {
        expect(result.agentId).toBe("device-agent");
        expect(result.source).toBe("binding");
      }
    });
  });

  describe("buildReplyTopicFromInbound", () => {
    it("should replace .in with .out", () => {
      const result = buildReplyTopicFromInbound("openclaw.agent.agent1.in", "openclaw");
      expect(result).toBe("openclaw.agent.agent1.out");
    });

    it("should append .out if not ending with .in", () => {
      const result = buildReplyTopicFromInbound("openclaw.agent.agent1", "openclaw");
      expect(result).toBe("openclaw.agent.agent1.out");
    });

    it("should handle custom prefix", () => {
      const result = buildReplyTopicFromInbound("custom.agent.agent1.in", "custom");
      expect(result).toBe("custom.agent.agent1.out");
    });
  });

  describe("buildOutboundTopic", () => {
    it("should build basic outbound topic", () => {
      const result = buildOutboundTopic("agent1", "openclaw");
      expect(result).toBe("openclaw.agent.agent1.out");
    });

    it("should build outbound topic with peer id", () => {
      const result = buildOutboundTopic("agent1", "openclaw", "device123");
      expect(result).toBe("openclaw.agent.agent1.out.device123");
    });

    it("should handle custom prefix", () => {
      const result = buildOutboundTopic("agent1", "custom");
      expect(result).toBe("custom.agent.agent1.out");
    });

    it("should handle empty prefix", () => {
      const result = buildOutboundTopic("agent1", "");
      expect(result).toBe("agent.agent1.out");
    });
  });
});

/**
 * MQTT Topic 路由模块单元测试
 *
 * 测试覆盖：
 * - 显式 Topic 绑定优先级
 * - 标准 Topic 回退路由
 * - 回复 Topic 推导
 * - MQTT 通配符匹配（+ / #）
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  matchTopic,
  getLoadedTopicMappings,
  resolveInboundRoute,
  resolveAgentId,
  buildOutboundTopic,
  buildStatusTopic,
  buildReplyTopicFromInbound,
  loadTopicMappings,
} from "../src/routing/topic-router.js";

describe("buildOutboundTopic / buildStatusTopic", () => {
  it("应构建正确的出站 Topic", () => {
    expect(buildOutboundTopic("sales-bot")).toBe("openclaw/agent/sales-bot/out");
  });

  it("应构建正确的状态 Topic", () => {
    expect(buildStatusTopic("sales-bot")).toBe("openclaw/agent/sales-bot/status");
  });
});

describe("resolveInboundRoute", () => {
  beforeEach(() => {
    loadTopicMappings([]);
  });

  it("显式绑定命中时应返回 binding 路由", () => {
    loadTopicMappings([
      {
        topicPattern: "devices/+/data",
        agentId: "iot-agent",
        accountId: "iot-account",
        replyTopic: "devices/reply",
      },
    ]);
    expect(resolveInboundRoute("devices/sensor-1/data")).toEqual({
      agentId: "iot-agent",
      accountId: "iot-account",
      replyTopic: "devices/reply",
      matchedPattern: "devices/+/data",
      source: "binding",
    });
  });

  it("未命中绑定时应回退标准 Topic 路由", () => {
    expect(resolveInboundRoute("openclaw/agent/assistant/in")).toEqual({
      agentId: "assistant",
      accountId: "default",
      replyTopic: "openclaw/agent/assistant/out",
      matchedPattern: "openclaw/agent/<agentId>/in",
      source: "standard",
    });
  });

  it("显式绑定优先于标准 Topic 路由", () => {
    loadTopicMappings([
      {
        topicPattern: "openclaw/agent/+/in",
        agentId: "custom-agent",
      },
    ]);
    const route = resolveInboundRoute("openclaw/agent/real-agent/in");
    expect(route?.agentId).toBe("custom-agent");
    expect(route?.source).toBe("binding");
  });

  it("应保留已加载映射用于诊断", () => {
    loadTopicMappings([{ topicPattern: "a/+", agentId: "demo" }]);
    expect(getLoadedTopicMappings().length).toBe(1);
  });
});

describe("resolveAgentId", () => {
  beforeEach(() => {
    loadTopicMappings([]);
  });

  it("应兼容返回 Agent ID", () => {
    expect(resolveAgentId("openclaw/agent/my-agent/in")).toBe("my-agent");
  });
});

describe("buildReplyTopicFromInbound", () => {
  it("应将 /in 替换为 /out", () => {
    expect(buildReplyTopicFromInbound("openclaw/agent/x/in")).toBe("openclaw/agent/x/out");
  });

  it("非 /in 结尾应追加 /out", () => {
    expect(buildReplyTopicFromInbound("device/topic")).toBe("device/topic/out");
  });
});

describe("matchTopic", () => {
  it("应支持 + 通配符", () => {
    expect(matchTopic("a/b/c", "a/+/c")).toBe(true);
  });

  it("应支持 # 通配符", () => {
    expect(matchTopic("a/b/c", "a/#")).toBe(true);
  });

  it("应正确处理不匹配场景", () => {
    expect(matchTopic("a/b/c", "a/d/c")).toBe(false);
  });
});

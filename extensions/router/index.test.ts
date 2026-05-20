/**
 * openclaw-router 单元测试
 *
 * 测试范围：配置解析、规则匹配（channels/direction/topic/accountId）、
 * 模板展开、路由分发逻辑、审计配置
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { matchRule, tmpl } from "./index.ts";

// ============================================================================
// tmpl — 模板展开
// ============================================================================

describe("tmpl", () => {
  it("替换单个变量", () => {
    expect(tmpl("hello {{name}}", { name: "world" })).toBe("hello world");
  });

  it("替换多个变量", () => {
    expect(tmpl("{{greeting}} {{name}}", { greeting: "hello", name: "world" })).toBe("hello world");
  });

  it("未定义变量保留原样", () => {
    expect(tmpl("hello {{missing}}", {})).toBe("hello {{missing}}");
  });

  it("无模板标记原样返回", () => {
    expect(tmpl("plain text", {})).toBe("plain text");
  });

  it("topic 模板场景", () => {
    expect(tmpl(
      "openclaw/router/{{channel}}/{{direction}}",
      { channel: "wecom", direction: "inbound" }
    )).toBe("openclaw/router/wecom/inbound");
  });

  it("空字符串", () => {
    expect(tmpl("", {})).toBe("");
  });

  it("模板中包含特殊字符", () => {
    expect(tmpl("user_{{id}}", { id: "123" })).toBe("user_123");
  });
});

// ============================================================================
// matchRule — 规则匹配
// ============================================================================

describe("matchRule", () => {
  const baseRule = {
    id: "test-rule",
    match: {} as { channels?: string[]; direction?: "inbound" | "outbound" | "both"; topic?: string; accountId?: string },
    actions: [] as Array<{ type: string; target: string; topic?: string }>,
  };

  describe("channels 匹配", () => {
    it("channels 包含该 channel 时匹配", () => {
      const rule = { ...baseRule, match: { channels: ["wecom", "dingtalk"] } };
      expect(matchRule(rule, "wecom", "inbound")).toBe(true);
    });

    it("channels 不包含该 channel 时不匹配", () => {
      const rule = { ...baseRule, match: { channels: ["wecom"] } };
      expect(matchRule(rule, "mqtt", "inbound")).toBe(false);
    });

    it("未指定 channels 时匹配任何渠道", () => {
      const rule = { ...baseRule, match: {} };
      expect(matchRule(rule, "any-channel", "inbound")).toBe(true);
    });

    it("空 channels 数组匹配任何渠道", () => {
      const rule = { ...baseRule, match: { channels: [] } };
      expect(matchRule(rule, "any-channel", "inbound")).toBe(true);
    });
  });

  describe("direction 匹配", () => {
    it("inbound 匹配 inbound", () => {
      const rule = { ...baseRule, match: { direction: "inbound" as const } };
      expect(matchRule(rule, "wecom", "inbound")).toBe(true);
      expect(matchRule(rule, "wecom", "outbound")).toBe(false);
    });

    it("outbound 匹配 outbound", () => {
      const rule = { ...baseRule, match: { direction: "outbound" as const } };
      expect(matchRule(rule, "wecom", "outbound")).toBe(true);
      expect(matchRule(rule, "wecom", "inbound")).toBe(false);
    });

    it("both 匹配两种方向", () => {
      const rule = { ...baseRule, match: { direction: "both" as const } };
      expect(matchRule(rule, "wecom", "inbound")).toBe(true);
      expect(matchRule(rule, "wecom", "outbound")).toBe(true);
    });

    it("未指定 direction 时匹配任何方向", () => {
      const rule = { ...baseRule, match: {} };
      expect(matchRule(rule, "wecom", "inbound")).toBe(true);
      expect(matchRule(rule, "wecom", "outbound")).toBe(true);
    });
  });

  describe("topic 匹配", () => {
    it("topic 精确匹配", () => {
      const rule = { ...baseRule, match: { topic: "alerts/critical" } };
      expect(matchRule(rule, "mqtt", "inbound", "alerts/critical")).toBe(true);
      expect(matchRule(rule, "mqtt", "inbound", "alerts/info")).toBe(false);
    });

    it("未指定 topic 时不限制", () => {
      const rule = { ...baseRule, match: {} };
      expect(matchRule(rule, "mqtt", "inbound", "any/topic")).toBe(true);
    });

    it("消息无 topic 但规则有 topic 时不匹配", () => {
      const rule = { ...baseRule, match: { topic: "specific" } };
      expect(matchRule(rule, "mqtt", "inbound", undefined)).toBe(false);
    });
  });

  describe("accountId 匹配", () => {
    it("accountId 精确匹配", () => {
      const rule = { ...baseRule, match: { accountId: "acct-1" } };
      expect(matchRule(rule, "wecom", "inbound", undefined, "acct-1")).toBe(true);
      expect(matchRule(rule, "wecom", "inbound", undefined, "acct-2")).toBe(false);
    });

    it("未指定 accountId 时不限制", () => {
      const rule = { ...baseRule, match: {} };
      expect(matchRule(rule, "wecom", "inbound", undefined, "any-account")).toBe(true);
    });
  });

  describe("组合条件", () => {
    it("所有条件同时满足", () => {
      const rule = {
        ...baseRule,
        match: { channels: ["wecom"], direction: "inbound" as const, topic: "alerts", accountId: "acct-1" },
      };
      expect(matchRule(rule, "wecom", "inbound", "alerts", "acct-1")).toBe(true);
    });

    it("其中一个条件不满足", () => {
      const rule = {
        ...baseRule,
        match: { channels: ["wecom"], direction: "inbound" as const, accountId: "acct-1" },
      };
      expect(matchRule(rule, "wecom", "inbound", undefined, "acct-2")).toBe(false);
    });

    it("渠道匹配但方向不匹配", () => {
      const rule = {
        ...baseRule,
        match: { channels: ["wecom"], direction: "outbound" as const },
      };
      expect(matchRule(rule, "wecom", "inbound")).toBe(false);
    });
  });
});

// ============================================================================
// 边界条件
// ============================================================================

describe("Router 边界条件", () => {
  it("tmpl 处理多个相同变量", () => {
    expect(tmpl("{{x}}+{{x}}", { x: "1" })).toBe("1+1");
  });

  it("tmpl 处理变量名含数字", () => {
    expect(tmpl("v{{id1}}", { id1: "42" })).toBe("v42");
  });

  it("matchRule 空规则永远匹配", () => {
    const rule = { id: "r", match: {}, actions: [] };
    expect(matchRule(rule, "any", "inbound")).toBe(true);
    expect(matchRule(rule, "any", "outbound")).toBe(true);
  });
});

// ============================================================================
// 典型路由场景
// ============================================================================

describe("典型路由场景", () => {
  it("wecom → mqtt 转发 (inbound)", () => {
    const rule = {
      id: "wecom-to-mqtt",
      match: { channels: ["wecom"], direction: "inbound" as const },
      actions: [{ type: "forward" as const, target: "mqtt", topic: "openclaw/router/{{channel}}/inbound" }],
    };
    expect(matchRule(rule, "wecom", "inbound")).toBe(true);
    expect(matchRule(rule, "mqtt", "inbound")).toBe(false);
  });

  it("mqtt → wecom 回复 (outbound)", () => {
    const rule = {
      id: "mqtt-to-wecom",
      match: { channels: ["mqtt"], direction: "outbound" as const },
      actions: [{ type: "reply-via" as const, target: "wecom" }],
    };
    expect(matchRule(rule, "mqtt", "outbound")).toBe(true);
    expect(matchRule(rule, "mqtt", "inbound")).toBe(false);
  });

  it("全渠道审计日志 (both)", () => {
    const rule = {
      id: "audit-all",
      match: { direction: "both" as const },
      actions: [{ type: "forward" as const, target: "mqtt", topic: "openclaw/audit" }],
    };
    expect(matchRule(rule, "wecom", "inbound")).toBe(true);
    expect(matchRule(rule, "dingtalk", "outbound")).toBe(true);
  });

  it("特定 topic 的告警路由", () => {
    const rule = {
      id: "critical-alerts",
      match: { topic: "alerts/critical" },
      actions: [{ type: "reply-via" as const, target: "wecom", accountId: "ops" }],
    };
    expect(matchRule(rule, "mqtt", "inbound", "alerts/critical")).toBe(true);
    expect(matchRule(rule, "mqtt", "inbound", "alerts/info")).toBe(false);
  });
});

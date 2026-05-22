/**
 * topic-router 单元测试。
 */

import { describe, expect, it } from "vitest";
import { matchTopic, resolveInboundRoute } from "../src/routing/topic-router.js";
import { DEFAULT_WEB_MQTT_CONFIG } from "../src/config.js";
import type { WebMqttConfig } from "../src/types.js";

function createConfig(partial: Partial<WebMqttConfig>): WebMqttConfig {
  return {
    ...DEFAULT_WEB_MQTT_CONFIG,
    ...partial,
  };
}

describe("matchTopic", () => {
  /**
   * 支持单级和多级通配符。
   */
  it("should support + and # wildcard", () => {
    expect(matchTopic("devices/a/in", "devices/+/in")).toBe(true);
    expect(matchTopic("devices/a/b/in", "devices/#")).toBe(true);
    expect(matchTopic("devices/a/in", "devices/+/out")).toBe(false);
  });
});

describe("resolveInboundRoute", () => {
  /**
   * 显式绑定应优先命中。
   */
  it("should prefer binding route", () => {
    const config = createConfig({
      subscribeTopics: ["devices/+/in"],
      topicBindings: [{ topicPattern: "devices/+/in", agentId: "iot-agent", replyTopic: "devices/reply" }],
    });
    const route = resolveInboundRoute("devices/abc/in", config);
    expect(route?.source).toBe("binding");
    expect(route?.agentId).toBe("iot-agent");
    expect(route?.replyTopic).toBe("devices/reply");
  });

  /**
   * 未命中绑定时回退标准 agent topic。
   */
  it("should fallback to standard route", () => {
    const config = createConfig({
      subscribeTopics: ["openclaw/agent/+/in"],
      topicPrefix: "openclaw/",
    });
    const route = resolveInboundRoute("openclaw/agent/sales/in", config);
    expect(route?.source).toBe("standard");
    expect(route?.agentId).toBe("sales");
  });
});

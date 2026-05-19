/**
 * mqtt-config 单元测试。
 */

import { describe, expect, it } from "vitest";
import { buildWebMqttConfigSnapshot, resolveWebMqttConfig, validateWebMqttConfig } from "./mqtt-config.js";

describe("resolveWebMqttConfig", () => {
  /**
   * 验证默认值与基础归一化行为。
   */
  it("should resolve defaults and normalize prefix", () => {
    const config = resolveWebMqttConfig({});
    expect(config.port).toBe(15675);
    expect(config.path).toBe("/ws");
    expect(config.topicPrefix).toBe("openclaw/");
  });

  /**
   * 验证绑定与订阅数组解析。
   */
  it("should parse bindings and subscribe topics", () => {
    const config = resolveWebMqttConfig({
      channels: {
        "mqtt-ws": {
          subscribeTopics: ["devices/+/in"],
          topicBindings: [{ topicPattern: "devices/+/in", agentId: "iot-agent" }],
        },
      },
    });
    expect(config.subscribeTopics).toEqual(["devices/+/in"]);
    expect(config.topicBindings).toHaveLength(1);
  });
});

describe("validateWebMqttConfig", () => {
  /**
   * 在 required 且无用户时给出告警。
   */
  it("should report auth warning", () => {
    const config = resolveWebMqttConfig({});
    const issues = validateWebMqttConfig(config);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("buildWebMqttConfigSnapshot", () => {
  /**
   * 输出快照应脱敏密码字段。
   */
  it("should not expose raw password", () => {
    const config = resolveWebMqttConfig({
      channels: {
        "mqtt-ws": {
          auth: {
            required: true,
            users: [{ username: "alice", password: "secret" }],
          },
        },
      },
    });
    const snapshot = buildWebMqttConfigSnapshot(config);
    const users = ((snapshot.auth as { users: Array<Record<string, unknown>> }).users ?? []);
    expect(users[0]?.hasPassword).toBe(true);
    expect(users[0]?.password).toBeUndefined();
  });
});

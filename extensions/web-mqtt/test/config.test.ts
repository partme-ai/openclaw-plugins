/**
 * mqtt-config 单元测试。
 */

import { describe, expect, it } from "vitest";
import { buildWebMqttConfigSnapshot, resolveWebMqttConfig, validateWebMqttConfig } from "../src/config.js";

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

  /**
   * 验证出站 wire 格式配置会传递给 reply 序列化层。
   */
  it("should preserve outbound wire format", () => {
    const config = resolveWebMqttConfig({
      channels: {
        "mqtt-ws": {
          payload: {
            mode: "jsonTextOrPlain",
            outboundFormat: "plainText",
          },
        },
      },
    });

    expect(config.payload.outboundFormat).toBe("plainText");
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

  it("should reject insecure non-loopback and unsupported proxy protocol", () => {
    const config = resolveWebMqttConfig({
      channels: { "mqtt-ws": { host: "0.0.0.0", auth: { required: false }, proxyProtocol: true } },
    });
    const issues = validateWebMqttConfig(config);
    expect(issues).toContain("未启用 TLS 时仅允许监听 loopback 地址。");
    expect(issues).toContain("proxyProtocol 尚未实现，禁止启用以避免错误信任来源地址。");
  });

  it("should require an explicit anonymous user ACL", () => {
    const config = resolveWebMqttConfig({
      channels: { "mqtt-ws": { host: "127.0.0.1", auth: { required: true, allowAnonymous: true } } },
    });
    expect(validateWebMqttConfig(config)).toContain(
      "auth.allowAnonymous=true 时必须配置 username=anonymous 的用户及 ACL。",
    );
  });

  it("should normalize browser origin allowlist and disable compression by default", () => {
    const config = resolveWebMqttConfig({
      channels: { "mqtt-ws": { ws: { allowedOrigins: ["https://console.example.com"] } } },
    });
    expect(config.ws.allowedOrigins).toEqual(["https://console.example.com"]);
    expect(config.ws.compress).toBe(false);
  });

  it("should reject a payload limit larger than the WebSocket frame limit", () => {
    const config = resolveWebMqttConfig({
      channels: { "mqtt-ws": { ws: { maxFrameSize: 1024 }, limits: { maxPayloadBytes: 2048 } } },
    });
    expect(validateWebMqttConfig(config)).toContain(
      "limits.maxPayloadBytes 不能大于 ws.maxFrameSize，否则 WebSocket 会先行断开。",
    );
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

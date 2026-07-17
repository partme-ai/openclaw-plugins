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

  it("should canonicalize and deduplicate valid browser origins", () => {
    const config = resolveWebMqttConfig({
      channels: {
        "mqtt-ws": {
          ws: {
            allowedOrigins: [
              " https://console.example.com/ ",
              "https://console.example.com",
            ],
          },
        },
      },
    });
    expect(config.ws.allowedOrigins).toEqual(["https://console.example.com"]);
  });

  it("should preserve invalid numbers so startup validation rejects them", () => {
    const config = resolveWebMqttConfig({
      channels: {
        "mqtt-ws": {
          port: 0,
          maxConnections: 1.5,
          limits: { maxPendingMessagesPerClient: -1 },
        },
      },
    });
    const issues = validateWebMqttConfig(config);
    expect(config.port).toBe(0);
    expect(config.maxConnections).toBe(1.5);
    expect(config.limits.maxPendingMessagesPerClient).toBe(-1);
    expect(issues.some((issue) => issue.includes("port"))).toBe(true);
    expect(issues.some((issue) => issue.includes("maxConnections"))).toBe(true);
    expect(issues.some((issue) => issue.includes("maxPendingMessagesPerClient"))).toBe(true);
  });

  it("should reject malformed origins, topic filters, ACL filters and reply topics", () => {
    const config = resolveWebMqttConfig({
      channels: {
        "mqtt-ws": {
          ws: { allowedOrigins: ["javascript:alert(1)"] },
          subscribeTopics: ["devices/#/admin"],
          topicBindings: [{
            topicPattern: "devices/sensor+/in",
            agentId: "iot",
            replyTopic: "devices/+/out",
          }],
          auth: {
            required: true,
            users: [{
              username: "alice",
              password: "secret",
              publishAllow: ["devices/foo#"],
            }],
          },
        },
      },
    });
    const issues = validateWebMqttConfig(config);
    expect(issues.some((issue) => issue.includes("allowedOrigins"))).toBe(true);
    expect(issues.some((issue) => issue.includes("subscribeTopics"))).toBe(true);
    expect(issues.some((issue) => issue.includes("topicPattern"))).toBe(true);
    expect(issues.some((issue) => issue.includes("replyTopic"))).toBe(true);
    expect(issues.some((issue) => issue.includes("ACL Topic Filter"))).toBe(true);
  });

  it("should reject a payload limit larger than the WebSocket frame limit", () => {
    const config = resolveWebMqttConfig({
      channels: { "mqtt-ws": { ws: { maxFrameSize: 1024 }, limits: { maxPayloadBytes: 2048 } } },
    });
    expect(validateWebMqttConfig(config)).toContain(
      "limits.maxPayloadBytes 不能大于 ws.maxFrameSize，否则 WebSocket 会先行断开。",
    );
  });

  it("should reject invalid limits, duplicate users, ambiguous credentials and unsafe remote auth", () => {
    const config = resolveWebMqttConfig({});
    const issues = validateWebMqttConfig({
      ...config,
      host: "0.0.0.0",
      tls: { ...config.tls, enabled: true, keyFile: "/tmp/key", certFile: "/tmp/cert" },
      auth: {
        required: false,
        allowAnonymous: false,
        users: [
          { username: "same", password: "one", passwordHash: "two" },
          { username: "same", password: "three" },
        ],
      },
      limits: {
        ...config.limits,
        maxPayloadBytes: 0,
        maxSubscriptionsPerClient: 0,
        maxPendingMessagesPerClient: 0,
        inboundTaskTimeoutMs: 0,
      },
    });
    expect(issues).toContain("监听非 loopback 地址时必须启用客户端认证。");
    expect(issues.some((issue) => issue.includes("重复用户名"))).toBe(true);
    expect(issues.some((issue) => issue.includes("必须且只能配置"))).toBe(true);
    expect(issues.some((issue) => issue.includes("maxPayloadBytes"))).toBe(true);
    expect(issues.some((issue) => issue.includes("maxSubscriptionsPerClient"))).toBe(true);
    expect(issues.some((issue) => issue.includes("maxPendingMessagesPerClient"))).toBe(true);
    expect(issues.some((issue) => issue.includes("inboundTaskTimeoutMs"))).toBe(true);
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
    expect((snapshot.auth as { userCount: number }).userCount).toBe(1);
    expect(JSON.stringify(snapshot)).not.toContain("secret");
  });

  it("should not expose TLS file paths or configured usernames", () => {
    const config = resolveWebMqttConfig({ channels: { "mqtt-ws": {
      auth: { required: true, users: [{ username: "private-user", password: "secret" }] },
      tls: { enabled: true, keyFile: "/private/server.key", certFile: "/private/server.crt" },
    } } });
    const serialized = JSON.stringify(buildWebMqttConfigSnapshot(config));
    expect(serialized).not.toContain("private-user");
    expect(serialized).not.toContain("/private/");
  });
});

import { afterEach, describe, expect, it } from "vitest";

import {
  buildStompConfigSnapshot,
  resolveStompWsConfig,
  validateStompWsConfig,
} from "../src/config.js";

const originalPassword = process.env.TEST_STOMP_PASSWORD;

afterEach(() => {
  if (originalPassword === undefined) delete process.env.TEST_STOMP_PASSWORD;
  else process.env.TEST_STOMP_PASSWORD = originalPassword;
});

describe("web-stomp config", () => {
  it("resolves nested production settings and legacy aliases", () => {
    const config = resolveStompWsConfig({
      channels: {
        stomp: {
          port: 18_674,
          host: "127.0.0.2",
          heartbeat: { serverMs: 2_000, clientMs: 3_000 },
          prefetchCount: 9,
          allowedAgentIds: ["support", "support", "ops"],
          limits: { maxConnections: 7, maxFrameSize: 8_192 },
          ws: { allowedOrigins: ["https://console.example.com"] },
          auth: { users: [{ login: "browser", passwordEnv: "TEST_STOMP_PASSWORD" }] },
        },
      },
    });

    expect(config).toMatchObject({
      wsPort: 18_674,
      host: "127.0.0.2",
      heartbeatOutgoing: 2_000,
      heartbeatIncoming: 3_000,
      maxConnections: 7,
      maxFrameSize: 8_192,
      maxPendingAcks: 9,
      allowedAgentIds: ["support", "ops"],
      allowedOrigins: ["https://console.example.com"],
    });
  });

  it("validates environment credentials at startup", () => {
    const config = resolveStompWsConfig({
      channels: {
        stomp: {
          auth: { users: [{ login: "browser", passwordEnv: "TEST_STOMP_PASSWORD" }] },
        },
      },
    });

    delete process.env.TEST_STOMP_PASSWORD;
    expect(validateStompWsConfig(config)).toContainEqual(expect.stringContaining("has no password"));
    process.env.TEST_STOMP_PASSWORD = "secret";
    expect(validateStompWsConfig(config)).toEqual([]);
  });

  it("redacts every credential from status snapshots", () => {
    const config = resolveStompWsConfig({
      channels: {
        stomp: {
          auth: {
            users: [
              { login: "plain", password: "never-return-this" },
              { login: "hashed", passwordHash: "deadbeef", hashAlgorithm: "sha512" },
            ],
          },
        },
      },
    });
    const serialized = JSON.stringify(buildStompConfigSnapshot(config));

    expect(serialized).not.toContain("never-return-this");
    expect(serialized).not.toContain("deadbeef");
    expect(serialized).toContain("credentialConfigured");
    expect(serialized).toContain("sha512");
  });

  it("保留非法数值并在启动校验中报告，而不是静默替换默认值", () => {
    const config = resolveStompWsConfig({
      channels: { stomp: { wsPort: 0, heartbeat: { serverMs: -1 }, limits: { maxConnections: 1.5 } } },
    });
    const issues = validateStompWsConfig(config);
    expect(config.wsPort).toBe(0);
    expect(config.heartbeatOutgoing).toBe(-1);
    expect(config.maxConnections).toBe(1.5);
    expect(issues.some((issue) => issue.includes("wsPort"))).toBe(true);
    expect(issues.some((issue) => issue.includes("heartbeatOutgoing"))).toBe(true);
    expect(issues.some((issue) => issue.includes("maxConnections"))).toBe(true);
  });

  it("规范化 Origin，并拒绝通配 Origin、非法 Agent id 与歧义凭证", () => {
    const normalized = resolveStompWsConfig({
      channels: { stomp: { ws: { allowedOrigins: [" https://console.example.com/ ", "https://console.example.com"] } } },
    });
    expect(normalized.allowedOrigins).toEqual(["https://console.example.com"]);

    const config = resolveStompWsConfig({
      channels: {
        stomp: {
          defaultAgentId: "bad agent",
          ws: { allowedOrigins: ["*"] },
          auth: { users: [{ login: "browser", password: "one", passwordHash: "two" }] },
        },
      },
    });
    const issues = validateStompWsConfig(config);
    expect(issues.some((issue) => issue.includes("allowedOrigins"))).toBe(true);
    expect(issues.some((issue) => issue.includes("defaultAgentId"))).toBe(true);
    expect(issues.some((issue) => issue.includes("exactly one"))).toBe(true);
  });
});

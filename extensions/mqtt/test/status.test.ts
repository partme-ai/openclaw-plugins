import { describe, expect, it } from "vitest";

import { resolveBrokerConfig } from "../src/config.js";
import { sanitizeMqttConfig } from "../src/index.js";

describe("sanitizeMqttConfig", () => {
  it("returns useful status without exposing credentials or persistence endpoints", () => {
    const config = resolveBrokerConfig({
      channels: {
        mqtt: {
          auth: {
            enabled: true,
            users: [{ username: "iot", password: "top-secret", publishAllow: ["devices/#"] }],
          },
          tls: {
            enabled: true,
            certFile: "/secret/server.pem",
            keyFile: "/secret/server.key",
            caFile: "/secret/ca.pem",
          },
          persistence: {
            enabled: true,
            backend: "redis",
            redis: { host: "private.redis", password: "redis-secret" },
          },
        },
      },
    });

    const sanitized = sanitizeMqttConfig(config);
    const serialized = JSON.stringify(sanitized);
    expect(sanitized).toMatchObject({
      auth: { enabled: true, userCount: 1 },
      tls: { enabled: true },
      persistence: { enabled: true, backend: "redis" },
    });
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("redis-secret");
    expect(serialized).not.toContain("private.redis");
    expect(serialized).not.toContain("/secret/");
  });
});

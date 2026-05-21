import { describe, expect, it } from "vitest";

import {
  hasLegacyMqttDmScope,
  resolveBrokerConfig,
  resolveOpenClawDmScope,
} from "../src/config.js";

describe("resolveBrokerConfig", () => {
  it("parses topicBindings and subscribeTopics", () => {
    const cfg = {
      channels: {
        mqtt: {
          port: 1883,
          subscribeTopics: ["devices/+/in"],
          topicBindings: [
            { topicPattern: "devices/+/in", agentId: "a1", accountId: "default", replyTopic: "devices/out" },
          ],
          payload: { mode: "jsonTextOrPlain" as const },
          auth: {
            enabled: true,
            allowAnonymous: false,
            users: [
              {
                username: "iot",
                passwordHash: "abcd",
                hashAlgorithm: "sha256" as const,
                aclRules: [
                  { action: "publish", topicPattern: "devices/+/in", effect: "allow" as const },
                  {
                    action: "outbound",
                    topicPattern: "devices/+/out",
                    effect: "allow" as const,
                    accountId: "default",
                  },
                ],
              },
            ],
          },
          tls: {
            enabled: true,
            port: 8883,
            certFile: "/etc/certs/server.pem",
            keyFile: "/etc/certs/server.key",
          },
          limits: {
            maxPayloadBytes: 4096,
          },
          session: {
            maxExpirySeconds: 3600,
            persistentAcrossReconnect: false,
          },
          qos0: {
            mailboxSoftLimit: 128,
          },
          retain: {
            allowInboundRetain: false,
            outboundRetain: true,
          },
          audit: {
            enabled: true,
            format: "json" as const,
          },
          will: {
            allow: true,
            allowedTopicPatterns: ["devices/+/will"],
          },
        },
      },
    };
    const r = resolveBrokerConfig(cfg);
    expect(r.port).toBe(1883);
    expect(r.subscribeTopics).toEqual(["devices/+/in"]);
    expect(r.topicBindings).toHaveLength(1);
    expect(r.topicBindings[0]?.agentId).toBe("a1");
    expect(r.auth.enabled).toBe(true);
    expect(r.auth.allowAnonymous).toBe(false);
    expect(r.tls.enabled).toBe(true);
    expect(r.tls.port).toBe(8883);
    expect(r.limits.maxPayloadBytes).toBe(4096);
    expect(r.session.maxExpirySeconds).toBe(3600);
    expect(r.session.persistentAcrossReconnect).toBe(false);
    expect(r.qos0.mailboxSoftLimit).toBe(128);
    expect(r.retain.allowInboundRetain).toBe(false);
    expect(r.retain.outboundRetain).toBe(true);
    expect(r.audit.enabled).toBe(true);
    expect(r.audit.format).toBe("json");
    expect(r.will.allow).toBe(true);
    expect(r.will.allowedTopicPatterns).toEqual(["devices/+/will"]);
    expect(r.auth.users[0]?.aclRules?.length).toBe(2);
  });

  it("applies defaults when channels.mqtt is missing", () => {
    const r = resolveBrokerConfig({});
    expect(r.port).toBe(1883);
    expect(r.subscribeTopics).toEqual([]);
    expect(r.topicBindings).toEqual([]);
    expect(r.tls.enabled).toBe(false);
    expect(r.auth.allowAnonymous).toBe(false);
    expect(r.limits.maxPayloadBytes).toBe(1024 * 1024);
    expect(r.session.maxExpirySeconds).toBe(86400);
    expect(r.session.persistentAcrossReconnect).toBe(true);
    expect(r.qos0.mailboxSoftLimit).toBe(200);
    expect(r.retain.allowInboundRetain).toBe(true);
    expect(r.retain.outboundRetain).toBe(false);
    expect(r.audit.enabled).toBe(false);
    expect(r.audit.format).toBe("json");
    expect(r.will.allow).toBe(true);
    expect(r.will.allowedTopicPatterns).toEqual([]);
  });

  it("reads OpenClaw global session.dmScope", () => {
    expect(resolveOpenClawDmScope({ session: { dmScope: "per-channel-peer" } })).toBe(
      "per-channel-peer",
    );
    expect(resolveOpenClawDmScope({})).toBe("main");
    expect(resolveOpenClawDmScope({ session: { dmScope: "invalid" } })).toBe("main");
  });

  it("detects legacy channels.mqtt.session.dmScope config", () => {
    expect(
      hasLegacyMqttDmScope({
        channels: {
          mqtt: {
            session: {
              dmScope: "per-channel-peer",
            },
          },
        },
      }),
    ).toBe(true);
    expect(hasLegacyMqttDmScope({})).toBe(false);
  });

  it("parses persistence config", () => {
    const cfg = {
      channels: {
        mqtt: {
          port: 1883,
          persistence: {
            enabled: true,
            backend: "redis",
            redis: {
              enabled: true,
              host: "redis.example.com",
              port: 6380,
              db: 1,
              keyPrefix: "mqtt:prod",
              subscriptionTTL: 7200,
              retainedTTL: 86400,
            },
          },
        },
      },
    };
    const r = resolveBrokerConfig(cfg);
    expect(r.persistence.enabled).toBe(true);
    expect(r.persistence.backend).toBe("redis");
    expect(r.persistence.redis?.enabled).toBe(true);
    expect(r.persistence.redis?.host).toBe("redis.example.com");
    expect(r.persistence.redis?.port).toBe(6380);
    expect(r.persistence.redis?.db).toBe(1);
    expect(r.persistence.redis?.keyPrefix).toBe("mqtt:prod");
    expect(r.persistence.redis?.subscriptionTTL).toBe(7200);
    expect(r.persistence.redis?.retainedTTL).toBe(86400);
  });

  it("applies persistence defaults when not configured", () => {
    const r = resolveBrokerConfig({});
    expect(r.persistence.enabled).toBe(false);
    expect(r.persistence.backend).toBe("memory");
    expect(r.persistence.redis?.enabled).toBe(false);
    expect(r.persistence.redis?.host).toBe("localhost");
    expect(r.persistence.redis?.port).toBe(6379);
    expect(r.persistence.redis?.db).toBe(0);
    expect(r.persistence.redis?.keyPrefix).toBe("mqtt");
    expect(r.persistence.redis?.subscriptionTTL).toBe(3600);
    expect(r.persistence.redis?.retainedTTL).toBe(0);
  });
});

/**
 * Web MQTT config/resolvers 单元测试。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEB_MQTT_AGENT_REPLY_TIMEOUT_MS,
  DEFAULT_WEB_MQTT_MEDIA_MAX_BYTES,
  WEB_MQTT_CHANNEL_ID,
  resolveWebMqttAgentReplyTimeoutMs,
  resolveWebMqttMediaMaxBytes,
} from "../src/config/resolvers.js";

describe("WEB_MQTT_CHANNEL_ID", () => {
  it("matches mqtt-ws channel key", () => {
    expect(WEB_MQTT_CHANNEL_ID).toBe("mqtt-ws");
  });
});

describe("resolveWebMqttAgentReplyTimeoutMs", () => {
  it("returns default when unset", () => {
    expect(resolveWebMqttAgentReplyTimeoutMs({})).toBe(DEFAULT_WEB_MQTT_AGENT_REPLY_TIMEOUT_MS);
  });

  it("reads channels.mqtt-ws.network override", () => {
    expect(
      resolveWebMqttAgentReplyTimeoutMs({
        channels: { "mqtt-ws": { network: { agentReplyTimeoutMs: 30_000 } } },
      }),
    ).toBe(30_000);
  });
});

describe("resolveWebMqttMediaMaxBytes", () => {
  it("returns default when unset", () => {
    expect(resolveWebMqttMediaMaxBytes({})).toBe(DEFAULT_WEB_MQTT_MEDIA_MAX_BYTES);
  });

  it("reads channels.mqtt-ws.media.maxBytes override", () => {
    expect(
      resolveWebMqttMediaMaxBytes({
        channels: { "mqtt-ws": { media: { maxBytes: 2048 } } },
      }),
    ).toBe(2048);
  });
});

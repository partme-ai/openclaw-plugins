/**
 * Web MQTT processInbound 单元测试（mock bridge + runtime）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn().mockResolvedValue(undefined),
  resolveChannelDispatchIdentity: vi.fn().mockResolvedValue({
    agentId: "iot-agent",
    sessionKey: "agent:iot-agent:mqtt-ws:direct:client-a",
  }),
}));

vi.mock("@partme.ai/openclaw-message-sdk/bridge", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@partme.ai/openclaw-message-sdk/bridge")>();
  return {
    ...actual,
    dispatchChannelMessage: mocks.dispatchChannelMessage,
    resolveChannelDispatchIdentity: mocks.resolveChannelDispatchIdentity,
  };
});

vi.mock("../src/transport/server.js", () => ({
  getClientUsername: vi.fn(() => "alice"),
  publishToTopic: vi.fn(),
}));

vi.mock("../src/outbound.js", () => ({
  publishOutboundText: vi.fn().mockResolvedValue(undefined),
}));

import { DEFAULT_WEB_MQTT_CONFIG } from "../src/config.js";
import { processInbound } from "../src/inbound.js";
import { setWebMqttRuntime } from "../src/runtime.js";
import type { WebMqttConfig } from "../src/types.js";

const { dispatchChannelMessage, resolveChannelDispatchIdentity } = mocks;

function baseConfig(overrides: Partial<WebMqttConfig> = {}): WebMqttConfig {
  return {
    ...DEFAULT_WEB_MQTT_CONFIG,
    auth: { required: false, allowAnonymous: true, users: [] },
    subscribeTopics: ["openclaw/agent/+/in"],
    topicBindings: [],
    ...overrides,
  };
}

describe("processInbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWebMqttRuntime({ config: {} } as never);
  });

  it("rejects unroutable topics", async () => {
    const result = await processInbound(
      {
        clientId: "c1",
        topic: "unknown/topic",
        payload: Buffer.from("hello"),
      },
      baseConfig(),
    );
    expect(result).toEqual({ accepted: false, reason: "topic_not_allowed_or_not_routable" });
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("rejects oversized payloads", async () => {
    const result = await processInbound(
      {
        clientId: "c1",
        topic: "openclaw/agent/demo/in",
        payload: Buffer.alloc(2 * 1024 * 1024),
      },
      baseConfig({ limits: { maxPayloadBytes: 1024, maxSubscriptionsPerClient: 50 } }),
    );
    expect(result).toEqual({ accepted: false, reason: "payload_too_large" });
  });

  it("rejects empty text after wire parse", async () => {
    const result = await processInbound(
      {
        clientId: "c1",
        topic: "openclaw/agent/demo/in",
        payload: Buffer.from("   "),
      },
      baseConfig(),
    );
    expect(result).toEqual({ accepted: false, reason: "empty_payload" });
  });

  it("dispatches standard-route messages", async () => {
    const result = await processInbound(
      {
        clientId: "client-a",
        topic: "openclaw/agent/demo/in",
        payload: Buffer.from("hello mqtt"),
        messageId: `mqtt-${Date.now()}-a`,
      },
      baseConfig(),
    );

    expect(result.accepted).toBe(true);
    expect(result.routeSource).toBe("standard");
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
    expect(dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      channel: "mqtt-ws",
      text: "hello mqtt",
      peerId: "client-a",
    });
  });

  it("prefers explicit topic binding route", async () => {
    const result = await processInbound(
      {
        clientId: "client-b",
        topic: "devices/sensor/in",
        payload: Buffer.from("bound"),
        messageId: `mqtt-${Date.now()}-b`,
      },
      baseConfig({
        subscribeTopics: ["devices/+/in"],
        topicBindings: [
          { topicPattern: "devices/+/in", agentId: "iot-agent", replyTopic: "devices/reply" },
        ],
      }),
    );

    expect(result.accepted).toBe(true);
    expect(result.routeSource).toBe("binding");
    expect(resolveChannelDispatchIdentity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: "iot-agent" }),
    );
  });

  it("drops duplicate messageId via idempotency cache", async () => {
    const messageId = `mqtt-dedup-${Date.now()}`;
    const event = {
      clientId: "client-dedup",
      topic: "openclaw/agent/demo/in",
      payload: Buffer.from("once"),
      messageId,
    };
    const config = baseConfig();

    expect((await processInbound(event, config)).accepted).toBe(true);
    expect((await processInbound(event, config)).accepted).toBe(false);
    expect((await processInbound(event, config)).reason).toBe("duplicate");
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(1);
  });
});

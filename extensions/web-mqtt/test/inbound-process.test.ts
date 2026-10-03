/**
 * Web MQTT processInbound 单元测试（mock bridge + runtime）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dispatchChannelMessage: vi.fn().mockResolvedValue({ deliveryOutcome: { kind: "delivered" } }),
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
import { getClientUsername } from "../src/transport/server.js";
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
    vi.mocked(getClientUsername).mockReturnValue("alice");
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
      baseConfig({
        limits: {
          maxPayloadBytes: 1024,
          maxSubscriptionsPerClient: 50,
          maxPendingMessagesPerClient: 8,
          inboundTaskTimeoutMs: 5_000,
        },
      }),
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
        payload: Buffer.from('{"text":"hello mqtt","idempotencyKey":"standard-1"}'),
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
      requireDeliveryIdentity: true,
    });
  });

  it("prefers explicit topic binding route", async () => {
    const result = await processInbound(
      {
        clientId: "client-b",
        topic: "devices/sensor/in",
        payload: Buffer.from('{"text":"bound","idempotencyKey":"bound-1"}'),
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

  it("passes repeated application IDs to the durable SDK for settlement", async () => {
    const messageId = `mqtt-dedup-${Date.now()}`;
    const event = {
      clientId: "client-dedup",
      topic: "openclaw/agent/demo/in",
      payload: Buffer.from(JSON.stringify({ text: "once", idempotencyKey: messageId })),
      messageId: "mqtt-packet-1",
    };
    const config = baseConfig();

    expect((await processInbound(event, config)).accepted).toBe(true);
    expect((await processInbound(event, config)).accepted).toBe(true);
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(2);
    expect(dispatchChannelMessage.mock.calls[0][0].deliveryIdentity).toBe(dispatchChannelMessage.mock.calls[1][0].deliveryIdentity);
  });

  it("never confirms an inflight duplicate before the SDK settles it", async () => {
    let finishFirst!: () => void;
    dispatchChannelMessage.mockImplementationOnce(() => new Promise((resolve) => {
      finishFirst = () => resolve({ deliveryOutcome: { kind: "delivered" } });
    }));
    dispatchChannelMessage.mockRejectedValueOnce(new Error("pending durable delivery"));
    const event = {
      clientId: "client-inflight",
      topic: "openclaw/agent/demo/in",
      payload: Buffer.from('{"text":"once","idempotencyKey":"inflight-app-id"}'),
    };
    const first = processInbound(event, baseConfig());
    await vi.waitFor(() => expect(dispatchChannelMessage).toHaveBeenCalledTimes(1));

    await expect(processInbound(event, baseConfig())).rejects.toThrow("pending durable delivery");
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(2);
    finishFirst();
    await first;
  });

  it("does not dedupe legitimate repeated plain-text publishes", async () => {
    const event = {
      clientId: "client-repeat",
      topic: "openclaw/agent/demo/in",
      payload: Buffer.from("same command"),
      messageId: "reusable-packet-id",
    };
    const config = baseConfig();

    expect((await processInbound(event, config)).accepted).toBe(true);
    expect((await processInbound(event, config)).accepted).toBe(true);
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(2);
    expect(dispatchChannelMessage.mock.calls[0][0]).toMatchObject({
      deliveryIdentity: undefined, requireDeliveryIdentity: false,
    });
  });

  it("uses one durable identity so the SDK can reject a changed body", async () => {
    const config = baseConfig();
    const event = { clientId: "client-a", topic: "openclaw/agent/demo/in", payload: Buffer.from('{"text":"first","idempotencyKey":"same"}') };
    await processInbound(event, config);
    await processInbound({ ...event, payload: Buffer.from('{"text":"second","idempotencyKey":"same"}') }, config);
    expect(dispatchChannelMessage.mock.calls[0][0].deliveryIdentity).toBe(dispatchChannelMessage.mock.calls[1][0].deliveryIdentity);
  });

  it("separates authenticated owners reusing a clientId and application ID", async () => {
    const cfg = baseConfig({ auth: { required: true, allowAnonymous: false, users: [
      { username: "alice", password: "secret", publishAllow: ["openclaw/#"] },
      { username: "bob", password: "secret", publishAllow: ["openclaw/#"] },
    ] } });
    const event = { clientId: "shared", topic: "openclaw/agent/demo/in",
      payload: Buffer.from('{"text":"hello","idempotencyKey":"same-app-id"}') };
    await processInbound({ ...event, authenticatedUsername: "alice" }, cfg);
    await processInbound({ ...event, authenticatedUsername: "bob" }, cfg);
    expect(dispatchChannelMessage.mock.calls[0][0].deliveryIdentity)
      .not.toBe(dispatchChannelMessage.mock.calls[1][0].deliveryIdentity);
  });

  it("releases the application idempotency claim after Agent failure", async () => {
    const key = `mqtt-retry-${Date.now()}`;
    const event = {
      clientId: "client-retry",
      topic: "openclaw/agent/demo/in",
      payload: Buffer.from(JSON.stringify({ text: "retry", idempotencyKey: key })),
    };
    dispatchChannelMessage.mockRejectedValueOnce(new Error("temporary Agent failure"));

    await expect(processInbound(event, baseConfig())).rejects.toThrow("temporary Agent failure");
    expect((await processInbound(event, baseConfig())).accepted).toBe(true);
    expect(dispatchChannelMessage).toHaveBeenCalledTimes(2);
  });

  it("fails closed when authenticated inbound identity is missing", async () => {
    vi.mocked(getClientUsername).mockReturnValueOnce(null);
    const result = await processInbound(
      {
        clientId: "missing-user",
        topic: "openclaw/agent/demo/in",
        payload: Buffer.from("secure message"),
      },
      baseConfig({
        auth: {
          required: true,
          allowAnonymous: false,
          users: [{ username: "alice", password: "secret", publishAllow: ["openclaw/#"] }],
        },
      }),
    );

    expect(result).toEqual({ accepted: false, reason: "acl_inbound_identity_missing" });
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("does not replace an empty connection identity snapshot with a later clientId owner", async () => {
    vi.mocked(getClientUsername).mockReturnValue("bob");
    const result = await processInbound(
      {
        clientId: "reused-client-id",
        authenticatedUsername: undefined,
        topic: "openclaw/agent/demo/in",
        payload: Buffer.from('{"text":"queued","idempotencyKey":"queued-1"}'),
      },
      baseConfig({
        auth: {
          required: true,
          allowAnonymous: false,
          users: [{ username: "bob", password: "secret", publishAllow: ["openclaw/#"] }],
        },
      }),
    );
    expect(result).toEqual({ accepted: false, reason: "acl_inbound_identity_missing" });
    expect(getClientUsername).not.toHaveBeenCalled();
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });

  it("uses the connection identity snapshot when the same clientId now belongs to another user", async () => {
    vi.mocked(getClientUsername).mockReturnValue("bob");
    const result = await processInbound(
      {
        clientId: "reused-client-id",
        authenticatedUsername: "alice",
        topic: "devices/secure/in",
        payload: Buffer.from('{"text":"alice queued this message","idempotencyKey":"alice-1"}'),
      },
      baseConfig({
        subscribeTopics: ["devices/#"],
        topicBindings: [{ topicPattern: "devices/#", agentId: "secure", accountId: "account-a" }],
        auth: {
          required: true,
          allowAnonymous: false,
          users: [
            {
              username: "alice",
              password: "alice-secret",
              aclRules: [{ action: "inbound", topicPattern: "devices/#", effect: "allow", accountId: "account-a" }],
            },
            {
              username: "bob",
              password: "bob-secret",
              aclRules: [{ action: "inbound", topicPattern: "devices/#", effect: "deny", accountId: "account-a" }],
            },
          ],
        },
      }),
    );

    expect(result).toMatchObject({ accepted: true, routeSource: "binding" });
    expect(getClientUsername).not.toHaveBeenCalled();
  });

  it("enforces account-scoped inbound ACL rules", async () => {
    const result = await processInbound(
      {
        clientId: "client-account",
        topic: "devices/secure/in",
        payload: Buffer.from("secure message"),
      },
      baseConfig({
        subscribeTopics: ["devices/#"],
        topicBindings: [{ topicPattern: "devices/#", agentId: "secure", accountId: "account-b" }],
        auth: {
          required: true,
          allowAnonymous: false,
          users: [{
            username: "alice",
            password: "secret",
            aclRules: [{
              action: "inbound",
              topicPattern: "devices/#",
              effect: "allow",
              accountId: "account-a",
            }],
          }],
        },
      }),
    );

    expect(result).toEqual({ accepted: false, reason: "acl_inbound_denied" });
    expect(dispatchChannelMessage).not.toHaveBeenCalled();
  });
});

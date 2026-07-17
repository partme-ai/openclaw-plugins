/**
 * MQTT outbound adapter 单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishMessage: vi.fn().mockResolvedValue(undefined),
  getClientUsername: vi.fn(() => "alice"),
}));

vi.mock("../src/transport/acl.js", () => ({
  isUserActionAllowed: vi.fn(() => true),
}));

vi.mock("../src/state/mqtt-state.js", () => ({
  getMqttChannelConfig: vi.fn(() => ({
    retain: { outboundRetain: false },
    auth: { enabled: true, users: [{ username: "alice" }] },
  })),
}));

import { getClientUsername, publishMessage } from "../src/transport/server.js";
import { isUserActionAllowed } from "../src/transport/acl.js";
import { resetSessionMappings, upsertSessionContext } from "../src/routing/session-mapper.js";
import { mqttOutbound } from "../src/outbound.js";

describe("mqttOutbound.sendText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionMappings();
  });

  it("awaits publishMessage to reply topic from session context", async () => {
    const sessionKey = "agent:demo:mqtt:direct:client-x";
    upsertSessionContext(sessionKey, {
      clientId: "client-x",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "custom/reply",
    });

    const result = await mqttOutbound.sendText!({
      to: sessionKey,
      text: "agent reply",
      deliveryQueueId: "core-durable-id",
    } as Parameters<NonNullable<typeof mqttOutbound.sendText>>[0]);

    expect(publishMessage).toHaveBeenCalledWith("custom/reply", "agent reply", 0, false);
    expect(result).toMatchObject({ channel: "mqtt", messageId: sessionKey });
  });

  it("propagates publish failures", async () => {
    const sessionKey = "agent:demo:mqtt:direct:client-y";
    upsertSessionContext(sessionKey, {
      clientId: "client-y",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "custom/reply",
    });
    vi.mocked(publishMessage).mockRejectedValueOnce(new Error("publish failed"));

    await expect(
      mqttOutbound.sendText!({
        to: sessionKey,
        text: "fail",
      } as Parameters<NonNullable<typeof mqttOutbound.sendText>>[0]),
    ).rejects.toThrow("publish failed");
  });

  it("publishes Router deliveries directly to the configured topic", async () => {
    const result = await mqttOutbound.sendText!({
      to: "openclaw-direct-topic:v1:audit%2Fevents",
      text: "routed",
      deliveryQueueId: "router-id",
    } as Parameters<NonNullable<typeof mqttOutbound.sendText>>[0]);

    expect(publishMessage).toHaveBeenCalledWith("audit/events", "routed", 1, false);
    expect(result).toMatchObject({ channel: "mqtt", messageId: "router-id" });
  });

  it("fails delivery when no live session route exists", async () => {
    await expect(
      mqttOutbound.sendText!({
        to: "agent:demo:mqtt:direct:missing-client",
        text: "reply",
      } as Parameters<NonNullable<typeof mqttOutbound.sendText>>[0]),
    ).rejects.toThrow(/no client for session/i);
  });

  it("fails closed when authenticated client identity cannot be resolved", async () => {
    const sessionKey = "agent:demo:mqtt:direct:identity-missing";
    upsertSessionContext(sessionKey, {
      clientId: "identity-missing",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "custom/reply",
    });
    vi.mocked(getClientUsername).mockReturnValueOnce(undefined);

    await expect(
      mqttOutbound.sendText!({
        to: sessionKey,
        text: "reply",
      } as Parameters<NonNullable<typeof mqttOutbound.sendText>>[0]),
    ).rejects.toThrow(/authenticated identity missing/i);
    expect(publishMessage).not.toHaveBeenCalled();
  });

  it("propagates outbound ACL denial as a delivery failure", async () => {
    const sessionKey = "agent:demo:mqtt:direct:acl-denied";
    upsertSessionContext(sessionKey, {
      clientId: "acl-denied",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "custom/reply",
    });
    vi.mocked(isUserActionAllowed).mockReturnValueOnce(false);

    await expect(
      mqttOutbound.sendText!({
        to: sessionKey,
        text: "reply",
      } as Parameters<NonNullable<typeof mqttOutbound.sendText>>[0]),
    ).rejects.toThrow(/outbound ACL denied/i);
    expect(publishMessage).not.toHaveBeenCalled();
  });
});

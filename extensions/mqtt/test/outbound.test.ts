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
    auth: { users: [{ username: "alice" }] },
  })),
}));

import { publishMessage } from "../src/transport/server.js";
import { upsertSessionContext } from "../src/routing/session-mapper.js";
import { mqttOutbound } from "../src/outbound.js";

describe("mqttOutbound.sendText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});

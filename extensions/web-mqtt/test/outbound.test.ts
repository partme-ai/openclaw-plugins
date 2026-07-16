/**
 * Web MQTT outbound 单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishToTopic: vi.fn(),
  getClientUsername: vi.fn(() => "alice"),
  getStats: vi.fn(() => ({})),
  startWebMqttServer: vi.fn(),
  stopWebMqttServer: vi.fn(),
  trackInboundAccepted: vi.fn(),
  trackInboundDropped: vi.fn(),
  trackRoute: vi.fn(),
}));

vi.mock("../src/transport/acl.js", () => ({
  isUserActionAllowed: vi.fn(() => true),
}));

vi.mock("../src/state/mqtt-state.js", () => ({
  getWebMqttChannelConfig: vi.fn(() => ({
    auth: { users: [{ username: "alice" }] },
  })),
}));

import { publishToTopic } from "../src/transport/server.js";
import { isUserActionAllowed } from "../src/transport/acl.js";
import { upsertSessionContext } from "../src/routing/session-mapper.js";
import { publishDirectText, publishOutboundText } from "../src/outbound.js";
import { mqttWsChannel } from "../src/channel.js";

describe("publishOutboundText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes to replyTopic from session context", async () => {
    const sessionKey = "agent:demo:mqtt-ws:direct:client-x";
    upsertSessionContext(sessionKey, {
      clientId: "client-x",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "custom/reply",
    });

    await publishOutboundText(sessionKey, "reply wire", "openclaw/");
    expect(publishToTopic).toHaveBeenCalledWith("custom/reply", "reply wire");
  });

  it("falls back to standard out topic when replyTopic missing", async () => {
    const sessionKey = "agent:sales:mqtt-ws:direct:client-y";
    upsertSessionContext(sessionKey, {
      clientId: "client-y",
      agentId: "sales",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/sales/in",
    });

    await publishOutboundText(sessionKey, "fallback", "openclaw/");
    expect(publishToTopic).toHaveBeenCalledWith("openclaw/agent/sales/out", "fallback");
  });

  it("silently returns when session context missing", async () => {
    await publishOutboundText("missing-session", "noop", "openclaw/");
    expect(publishToTopic).not.toHaveBeenCalled();
  });

  it("skips publish when ACL denies outbound", async () => {
    const sessionKey = "agent:demo:mqtt-ws:direct:client-z";
    upsertSessionContext(sessionKey, {
      clientId: "client-z",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "denied/out",
    });
    vi.mocked(isUserActionAllowed).mockReturnValueOnce(false);

    await publishOutboundText(sessionKey, "blocked", "openclaw/");
    expect(publishToTopic).not.toHaveBeenCalled();
  });

  it("publishes Router deliveries directly to their configured topic", async () => {
    await publishDirectText("audit/events", "routed");
    expect(publishToTopic).toHaveBeenCalledWith("audit/events", "routed");
  });

  it("uses the explicit Router target contract and leaves core durable replies on session routing", async () => {
    const sendText = mqttWsChannel.outbound.sendText;
    await sendText({
      cfg: {}, to: "openclaw-direct-topic:v1:audit%2Fevents", text: "routed", deliveryQueueId: "router-id",
    } as never);
    expect(publishToTopic).toHaveBeenCalledWith("audit/events", "routed");

    const sessionKey = "agent:demo:mqtt-ws:direct:core-peer";
    upsertSessionContext(sessionKey, {
      clientId: "core-peer", agentId: "demo", accountId: "default", lastInboundTopic: "in", replyTopic: "safe/reply",
    });
    await sendText({ cfg: {}, to: sessionKey, text: "core reply", deliveryQueueId: "core-durable-id" } as never);
    expect(publishToTopic).toHaveBeenLastCalledWith("safe/reply", "core reply");
  });
});

/**
 * Web MQTT outbound 单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishToTopic: vi.fn().mockResolvedValue(1),
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
    auth: { required: true, users: [{ username: "alice" }] },
  })),
}));

import { getClientUsername, publishToTopic } from "../src/transport/server.js";
import { isUserActionAllowed } from "../src/transport/acl.js";
import { upsertSessionContext } from "../src/routing/session-mapper.js";
import { publishDirectText, publishOutboundText } from "../src/outbound.js";
import { mqttWsChannel } from "../src/channel.js";

describe("publishOutboundText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(publishToTopic).mockResolvedValue(1);
    vi.mocked(getClientUsername).mockReturnValue("alice");
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

  it("fails when session context is missing", async () => {
    await expect(publishOutboundText("missing-session", "noop", "openclaw/")).rejects.toThrow(/Missing session context/);
    expect(publishToTopic).not.toHaveBeenCalled();
  });

  it("fails when ACL denies outbound", async () => {
    const sessionKey = "agent:demo:mqtt-ws:direct:client-z";
    upsertSessionContext(sessionKey, {
      clientId: "client-z",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "denied/out",
    });
    vi.mocked(isUserActionAllowed).mockReturnValueOnce(false);

    await expect(publishOutboundText(sessionKey, "blocked", "openclaw/")).rejects.toThrow(/Outbound ACL denied/);
    expect(publishToTopic).not.toHaveBeenCalled();
  });

  it("fails closed when authenticated session identity is missing", async () => {
    const sessionKey = "agent:demo:mqtt-ws:direct:missing-identity";
    upsertSessionContext(sessionKey, {
      clientId: "missing-identity",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "secure/out",
    });
    vi.mocked(getClientUsername).mockReturnValueOnce(null);

    await expect(publishOutboundText(sessionKey, "blocked", "openclaw/"))
      .rejects.toThrow(/Authenticated identity missing/);
    expect(publishToTopic).not.toHaveBeenCalled();
  });

  it("fails when no active subscriber accepts the reply", async () => {
    const sessionKey = "agent:demo:mqtt-ws:direct:no-subscriber";
    upsertSessionContext(sessionKey, {
      clientId: "no-subscriber",
      agentId: "demo",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/demo/in",
      replyTopic: "missing/out",
    });
    vi.mocked(publishToTopic).mockResolvedValue(0);
    await expect(publishOutboundText(sessionKey, "lost", "openclaw/")).rejects.toThrow(/No active subscriber/);
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

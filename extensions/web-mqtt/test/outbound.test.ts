/**
 * Web MQTT outbound 单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishToTopic: vi.fn(),
  getClientUsername: vi.fn(() => "alice"),
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
import { publishOutboundText } from "../src/outbound.js";

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
});

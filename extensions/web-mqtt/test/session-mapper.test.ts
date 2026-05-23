/**
 * session-mapper 单元测试。
 */

import { describe, expect, it } from "vitest";
import { upsertSessionContext, getSessionContext } from "../src/routing/session-mapper.js";

describe("session mapper", () => {
  it("stores outbound context by OpenClaw sessionKey", () => {
    const sessionKey = "agent:agent-a:mqtt-ws:direct:client-a";
    const session = upsertSessionContext(sessionKey, {
      clientId: "client-a",
      agentId: "agent-a",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/agent-a/in",
      replyTopic: "custom/reply",
    });
    expect(session.sessionKey).toBe(sessionKey);
    expect(session.replyTopic).toBe("custom/reply");
  });

  it("updates replyTopic on subsequent upsert", () => {
    const sessionKey = "agent:agent-b:mqtt-ws:direct:client-b";
    upsertSessionContext(sessionKey, {
      clientId: "client-b",
      agentId: "agent-b",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/agent-b/in",
    });
    upsertSessionContext(sessionKey, {
      clientId: "client-b",
      agentId: "agent-b",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/agent-b/in",
      replyTopic: "x/reply",
    });
    expect(getSessionContext(sessionKey)?.replyTopic).toBe("x/reply");
  });

  it("preserves distinct session keys from resolveAgentRoute", () => {
    upsertSessionContext("agent:a1:main", {
      clientId: "c1",
      agentId: "a1",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/a1/in",
    });
    upsertSessionContext("agent:a2:main", {
      clientId: "c2",
      agentId: "a2",
      accountId: "default",
      lastInboundTopic: "openclaw/agent/a2/in",
    });
    expect(getSessionContext("agent:a1:main")?.clientId).toBe("c1");
    expect(getSessionContext("agent:a2:main")?.clientId).toBe("c2");
  });
});

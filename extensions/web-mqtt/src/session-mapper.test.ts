/**
 * session-mapper 单元测试。
 */

import { describe, expect, it } from "vitest";
import { getOrCreateSessionContext, getSessionContext } from "./session-mapper.js";

describe("session mapper", () => {
  /**
   * 首次入站应创建 session 并保存 replyTopic。
   */
  it("should create session context", () => {
    const session = getOrCreateSessionContext({
      clientId: "client-a",
      agentId: "agent-a",
      accountId: "default",
      dmScope: "per-channel-peer",
      inboundTopic: "openclaw/agent/agent-a/in",
      replyTopic: "custom/reply",
    });
    expect(session.sessionKey).toBe("agent:agent-a:mqtt-ws:direct:client-a");
    expect(session.replyTopic).toBe("custom/reply");
  });

  /**
   * 同一 client-agent 复用已有 session。
   */
  it("should reuse same session", () => {
    const first = getOrCreateSessionContext({
      clientId: "client-b",
      agentId: "agent-b",
      accountId: "default",
      dmScope: "per-channel-peer",
      inboundTopic: "openclaw/agent/agent-b/in",
    });
    const second = getOrCreateSessionContext({
      clientId: "client-b",
      agentId: "agent-b",
      accountId: "default",
      dmScope: "per-channel-peer",
      inboundTopic: "openclaw/agent/agent-b/in",
      replyTopic: "x/reply",
    });
    expect(second.sessionKey).toBe(first.sessionKey);
    expect(getSessionContext(first.sessionKey)?.replyTopic).toBe("x/reply");
  });

  /**
   * dmScope=main 时按 agent 维度收敛会话键。
   */
  it("should honor dmScope=main", () => {
    const one = getOrCreateSessionContext({
      clientId: "c1",
      agentId: "a1",
      accountId: "default",
      dmScope: "main",
      inboundTopic: "openclaw/agent/a1/in",
    });
    const two = getOrCreateSessionContext({
      clientId: "c2",
      agentId: "a2",
      accountId: "default",
      dmScope: "main",
      inboundTopic: "openclaw/agent/a2/in",
    });
    expect(one.sessionKey).toBe("agent:a1:main");
    expect(two.sessionKey).toBe("agent:a1:main");
  });
});

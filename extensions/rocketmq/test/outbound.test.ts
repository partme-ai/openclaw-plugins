import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({
  publishMessage: vi.fn().mockResolvedValue({ messageId: "broker-id" }),
}));

import { rockermqOutbound } from "../src/outbound.js";
import { publishMessage } from "../src/transport/server.js";
import { upsertSessionContext } from "../src/routing/session-mapper.js";

describe("rockermqOutbound Router delivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishes directly to the configured topic with a stable key", async () => {
    const result = await rockermqOutbound.sendText({
      to: "openclaw-direct-topic:v1:audit-events",
      text: "routed",
      deliveryQueueId: "router-id",
    });
    expect(publishMessage).toHaveBeenCalledWith({
      topic: "audit-events",
      payload: "routed",
      keys: ["router-id"],
    });
    expect(result).toEqual({ channel: "rocketmq", messageId: "broker-id" });
  });

  it("keeps ordinary durable replies on the session reply topic", async () => {
    const sessionKey = "agent:demo:rocketmq:direct:peer-1";
    upsertSessionContext(sessionKey, {
      peerId: "peer-1",
      agentId: "demo",
      accountId: "default",
      replyTopic: "reply-safe",
      replyTag: "reply",
      updatedAt: 0,
    });
    await rockermqOutbound.sendText({
      to: sessionKey,
      text: "core reply",
      deliveryQueueId: "core-durable-id",
    });
    expect(publishMessage).toHaveBeenCalledWith(
      expect.objectContaining({ topic: "reply-safe", tag: "reply" }),
    );
  });

  it("fails when an ordinary outbound target has no session context", async () => {
    await expect(
      rockermqOutbound.sendText({
        to: "agent:missing:rocketmq:direct:peer",
        text: "must not disappear",
      }),
    ).rejects.toThrow("No session context");
    expect(publishMessage).not.toHaveBeenCalled();
  });
});

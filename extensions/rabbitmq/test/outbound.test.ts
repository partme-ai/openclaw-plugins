import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/server.js", () => ({ publishMessage: vi.fn().mockResolvedValue(undefined) }));

import { rabbitmqOutbound } from "../src/outbound.js";
import { publishMessage } from "../src/transport/server.js";
import { upsertSessionContext } from "../src/routing/session-mapper.js";

describe("rabbitmqOutbound Router delivery", () => {
  beforeEach(() => vi.clearAllMocks());

  it("publishes directly to the configured routing key with correlation id", async () => {
    const result = await rabbitmqOutbound.sendText!({
      cfg: {} as never,
      to: "openclaw-direct-topic:v1:audit.events",
      text: "routed",
      deliveryQueueId: "router-id",
    });
    expect(publishMessage).toHaveBeenCalledWith("audit.events", "routed", {
      persistent: true,
      correlationId: "router-id",
    });
    expect(result).toMatchObject({ channel: "rabbitmq", messageId: "router-id" });
  });

  it("keeps ordinary durable replies on the session reply topic", async () => {
    const sessionKey = "agent:demo:rabbitmq:direct:peer-1";
    upsertSessionContext(sessionKey, {
      peerId: "peer-1", agentId: "demo", accountId: "default", replyTopic: "reply.safe", updatedAt: 0,
    });
    await rabbitmqOutbound.sendText!({
      cfg: {} as never,
      to: sessionKey,
      text: "core reply",
      deliveryQueueId: "core-durable-id",
    });
    expect(publishMessage).toHaveBeenCalledWith("reply.safe", "core reply");
  });

  it("missing session mapping throws so Router can retry instead of accepting a placeholder id", async () => {
    await expect(rabbitmqOutbound.sendText!({
      cfg: {} as never,
      to: "agent:missing:rabbitmq:offline",
      text: "do not drop",
      deliveryQueueId: "router-missing",
    })).rejects.toThrow("No peer mapping");
    expect(publishMessage).not.toHaveBeenCalled();
  });
});

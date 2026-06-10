/**
 * Redis Stream outbound adapter 单元测试。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/transport/publisher.js", () => ({
  publishEntry: vi.fn().mockResolvedValue("100-0"),
  publishMessage: vi.fn().mockResolvedValue(undefined),
}));

import { publishEntry, publishMessage } from "../src/transport/publisher.js";
import { redisStreamOutbound } from "../src/outbound.js";

describe("redisStreamOutbound.sendText", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses XADD in stream channelMode", async () => {
    const result = await redisStreamOutbound.sendText({
      cfg: {
        channels: {
          "redis-stream": {
            url: "redis://localhost:6379",
            channelMode: "stream",
            stream: { outboundKey: "openclaw:outbound" },
            fieldMapping: { textField: "text" },
          },
        },
      },
      text: "agent reply",
    });

    expect(publishEntry).toHaveBeenCalledWith("openclaw:outbound", { text: "agent reply" });
    expect(publishMessage).not.toHaveBeenCalled();
    expect(result).toMatchObject({ channel: "redis-stream", messageId: "100-0" });
  });

  it("uses PUBLISH in pubsub channelMode", async () => {
    const result = await redisStreamOutbound.sendText({
      cfg: {
        channels: {
          "redis-stream": {
            url: "redis://localhost:6379",
            channelMode: "pubsub",
          },
        },
      },
      text: "pubsub reply",
    });

    expect(publishMessage).toHaveBeenCalledWith("openclaw:agent:outbound", "pubsub reply");
    expect(publishEntry).not.toHaveBeenCalled();
    expect(result.channel).toBe("redis-stream");
    expect(result.messageId).toMatch(/^openclaw:agent:outbound:/);
  });
});

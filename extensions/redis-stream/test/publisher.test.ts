/**
 * Redis Stream publisher 单元测试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RedisConnectionError } from "../src/shared/errors.js";
import {
  clearPublisherClient,
  getMessagesWritten,
  incrMessagesWritten,
  publishEntry,
  publishMessage,
  setPublisherClient,
} from "../src/transport/publisher.js";

describe("transport/publisher", () => {
  beforeEach(() => {
    clearPublisherClient();
    incrMessagesWritten(-getMessagesWritten());
  });

  afterEach(() => {
    clearPublisherClient();
  });

  it("throws RedisConnectionError when client is not set", async () => {
    await expect(publishMessage("ch", "msg")).rejects.toBeInstanceOf(RedisConnectionError);
    await expect(publishEntry("stream", { text: "x" })).rejects.toBeInstanceOf(RedisConnectionError);
  });

  it("publishMessage delegates to redis client.publish", async () => {
    const publish = vi.fn().mockResolvedValue(1);
    setPublisherClient({ publish } as never);

    await publishMessage("openclaw:inbound", "hello");
    expect(publish).toHaveBeenCalledWith("openclaw:inbound", "hello");
    expect(getMessagesWritten()).toBe(1);
  });

  it("publishEntry delegates to redis client.xAdd", async () => {
    const xAdd = vi.fn().mockResolvedValue("170-0");
    setPublisherClient({ xAdd } as never);

    const id = await publishEntry("openclaw:outbound", { text: "reply" });
    expect(xAdd).toHaveBeenCalledWith("openclaw:outbound", "*", { text: "reply" });
    expect(id).toBe("170-0");
    expect(getMessagesWritten()).toBe(1);
  });

  it("clearPublisherClient resets client reference", async () => {
    setPublisherClient({ publish: vi.fn() } as never);
    clearPublisherClient();
    await expect(publishMessage("ch", "x")).rejects.toBeInstanceOf(RedisConnectionError);
  });

  it("incrMessagesWritten accumulates counter", () => {
    incrMessagesWritten(2);
    incrMessagesWritten();
    expect(getMessagesWritten()).toBe(3);
  });
});

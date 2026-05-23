import { describe, it, expect, beforeEach } from "vitest";
import {
  buildLegacyChatQueueKey,
  enqueueLegacyChatTask,
  hasLegacyChatTask,
  _resetLegacyChatQueueState,
} from "./chat-queue.js";

describe("legacy chat-queue", () => {
  beforeEach(() => {
    _resetLegacyChatQueueState();
  });

  it("buildLegacyChatQueueKey combines accountId and chatId", () => {
    expect(buildLegacyChatQueueKey("acc1", "chat1")).toBe("acc1:chat1");
  });

  it("serializes tasks for the same chat key", async () => {
    const order: number[] = [];

    const t1 = enqueueLegacyChatTask({
      accountId: "acc",
      chatId: "c1",
      task: async () => {
        order.push(1);
        await new Promise((r) => setTimeout(r, 20));
        order.push(2);
      },
    });
    expect(t1.status).toBe("immediate");

    const t2 = enqueueLegacyChatTask({
      accountId: "acc",
      chatId: "c1",
      task: async () => {
        order.push(3);
      },
    });
    expect(t2.status).toBe("queued");
    expect(hasLegacyChatTask("acc:c1")).toBe(true);

    await Promise.all([t1.promise, t2.promise]);
    expect(order).toEqual([1, 2, 3]);
  });
});

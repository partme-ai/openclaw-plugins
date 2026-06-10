/**
 * 入站 per-client 串行队列行为测试（与 transport/server 使用同一 message-sdk 原语）。
 */
import { describe, expect, it, vi } from "vitest";
import { createKeyedRunQueue } from "@partme.ai/openclaw-message-sdk";

describe("web-mqtt inbound keyed queue pattern", () => {
  it("serializes dispatch per clientId while allowing parallel clients", async () => {
    const order: string[] = [];
    const queue = createKeyedRunQueue();

    const slow = (label: string, ms: number) =>
      queue.enqueue("client-a", async () => {
        order.push(`${label}-start`);
        await new Promise((resolve) => setTimeout(resolve, ms));
        order.push(`${label}-end`);
      });

    const p1 = slow("m1", 30);
    const p2 = slow("m2", 10);
    const p3 = queue.enqueue("client-b", async () => {
      order.push("b1-start");
      order.push("b1-end");
    });

    await Promise.all([p1, p2, p3]);

    expect(order.indexOf("m1-start")).toBeLessThan(order.indexOf("m1-end"));
    expect(order.indexOf("m1-end")).toBeLessThan(order.indexOf("m2-start"));
    expect(order).toContain("b1-end");
  });

  it("surfaces handler errors via onError", async () => {
    const onError = vi.fn();
    const queue = createKeyedRunQueue({ onError });

    await expect(
      queue.enqueue("client-x", async () => {
        throw new Error("dispatch failed");
      }),
    ).rejects.toThrow("dispatch failed");

    expect(onError).toHaveBeenCalledWith(expect.any(Error), "client-x");
  });
});

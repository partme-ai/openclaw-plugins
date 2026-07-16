import { describe, expect, it, vi } from "vitest";

import { buildTextMessage } from "../core/index.js";
import { OutboundMessageQueue } from "./outbound-message-queue.js";

function item(sessionKey: string, text: string) {
  return {
    sessionKey,
    message: buildTextMessage("test", "default", "user", text),
    text,
  };
}

describe("OutboundMessageQueue", () => {
  it("enforces a global bound across sessions and reports overflow", () => {
    const onOverflow = vi.fn();
    const queue = new OutboundMessageQueue({ maxSize: 2, onOverflow });

    expect(queue.push(item("a", "one"))).toBe(true);
    expect(queue.push(item("b", "two"))).toBe(true);
    expect(queue.push(item("c", "three"))).toBe(false);
    expect(queue.size).toBe(2);
    expect(onOverflow).toHaveBeenCalledOnce();

    expect(queue.pop("a")?.text).toBe("one");
    expect(queue.push(item("c", "three"))).toBe(true);
    expect(queue.size).toBe(2);
  });

  it("keeps the total size correct when clearing one session or all sessions", () => {
    const queue = new OutboundMessageQueue({ maxSize: 5 });
    queue.push(item("a", "one"));
    queue.push(item("a", "two"));
    queue.push(item("b", "three"));

    queue.clear("a");
    expect(queue.size).toBe(1);
    expect(queue.peek("b")?.text).toBe("three");
    queue.clear();
    expect(queue.size).toBe(0);
  });

  it("rejects invalid capacity configuration", () => {
    expect(() => new OutboundMessageQueue({ maxSize: -1 })).toThrow(/positive safe integer/);
  });
});

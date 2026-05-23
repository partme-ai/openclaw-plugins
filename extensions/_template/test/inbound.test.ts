import { describe, expect, it } from "vitest";

import { clearDedupeCache, isDuplicateMessage } from "../src/inbound.js";

describe("inbound dedupe", () => {
  it("treats repeated messageId as duplicate within TTL window", () => {
    clearDedupeCache();
    expect(isDuplicateMessage("msg-1")).toBe(false);
    expect(isDuplicateMessage("msg-1")).toBe(true);
  });
});

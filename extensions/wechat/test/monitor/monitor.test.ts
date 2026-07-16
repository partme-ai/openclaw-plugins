import { describe, expect, it, vi } from "vitest";

import { clampLongPollTimeout, processUpdateBatch } from "../../src/monitor/monitor.js";

describe("processUpdateBatch", () => {
  it("commits the next cursor only after every message succeeds", async () => {
    const events: string[] = [];
    await processUpdateBatch({
      messages: ["one", "two"],
      nextSyncBuf: "next",
      processMessage: async (message) => { events.push(message); },
      commitSyncBuf: (cursor) => { events.push(`commit:${cursor}`); },
    });
    expect(events).toEqual(["one", "two", "commit:next"]);
  });

  it("does not advance the cursor when a message fails", async () => {
    const commitSyncBuf = vi.fn();
    await expect(processUpdateBatch({
      messages: ["one", "two"],
      nextSyncBuf: "next",
      processMessage: async (message) => {
        if (message === "two") throw new Error("dispatch failed");
      },
      commitSyncBuf,
    })).rejects.toThrow("dispatch failed");
    expect(commitSyncBuf).not.toHaveBeenCalled();
  });
});

describe("clampLongPollTimeout", () => {
  it("clamps server-provided values to the safe range", () => {
    expect(clampLongPollTimeout(1)).toBe(1_000);
    expect(clampLongPollTimeout(35_000)).toBe(35_000);
    expect(clampLongPollTimeout(600_000)).toBe(60_000);
  });
});

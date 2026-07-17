import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { replayBacklogForAccount } from "../src/dispatch/backlog-replay.js";
import {
  readBacklogCursor,
  writeBacklogCursor,
} from "../src/dispatch/backlog-cursor.js";
import { resolveGotifyAccount } from "../src/config.js";

function makeAccount() {
  return resolveGotifyAccount(
    {
      channels: {
        gotify: {
          accounts: {
            e2e: {
              serverUrl: "https://push.example.com",
              appToken: "app-token",
              clientToken: "client-token",
              inbound: {
                enabled: true,
                allowedAppId: 42,
              },
              allowFrom: ["*"],
            },
          },
        },
      },
    },
    "e2e",
  );
}

describe("backlog replay", () => {
  let tempStateDir: string;

  beforeEach(async () => {
    tempStateDir = await mkdtemp(path.join(os.tmpdir(), "gotify-replay-"));
    process.env.OPENCLAW_STATE_DIR = tempStateDir;
  });

  afterEach(async () => {
    delete process.env.OPENCLAW_STATE_DIR;
    await rm(tempStateDir, { recursive: true, force: true });
  });

  it("replays messages one by one in ascending id order and persists cursor", async () => {
    const dispatched: number[] = [];
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({
        messages: [
          { id: 5, appid: 42, message: "m5" },
          { id: 3, appid: 42, message: "m3" },
          { id: 4, appid: 42, message: "m4" },
        ],
        paging: { size: 3, limit: 100, next: null, since: 0 },
      })
      .mockResolvedValueOnce({
        messages: [],
        paging: { size: 0, limit: 100, next: null, since: 3 },
      });

    const result = await replayBacklogForAccount({
      account: makeAccount(),
      fetchPage,
      dispatch: async (message) => {
        dispatched.push(Number(message.id));
      },
    });

    expect(dispatched).toEqual([3, 4, 5]);
    expect(result).toEqual({ replayed: 3, lastSeenMessageId: 5 });
    await expect(readBacklogCursor("e2e", 42)).resolves.toBe(5);
  });

  it("resumes from persisted cursor and only replays newer ids", async () => {
    await writeBacklogCursor("e2e", 42, 4);
    const dispatched: number[] = [];
    const fetchPage = vi.fn().mockResolvedValueOnce({
      messages: [
        { id: 6, appid: 42, message: "m6" },
        { id: 5, appid: 42, message: "m5" },
        { id: 4, appid: 42, message: "m4" },
      ],
      paging: { size: 3, limit: 100, next: null, since: 0 },
    });

    const result = await replayBacklogForAccount({
      account: makeAccount(),
      fetchPage,
      dispatch: async (message) => {
        dispatched.push(Number(message.id));
      },
    });

    expect(dispatched).toEqual([5, 6]);
    expect(result).toEqual({ replayed: 2, lastSeenMessageId: 6 });
  });

  it("resets cursor when allowedAppId changes", async () => {
    await writeBacklogCursor("e2e", 7, 99);

    await expect(readBacklogCursor("e2e", 42)).resolves.toBe(0);
  });

  it("never lets an out-of-order live message move the persisted cursor backwards", async () => {
    await writeBacklogCursor("e2e", 42, 100);
    await writeBacklogCursor("e2e", 42, 80);

    await expect(readBacklogCursor("e2e", 42)).resolves.toBe(100);
  });

  it("fails closed when the persisted cursor is corrupt", async () => {
    const cursorDir = path.join(tempStateDir, "gotify", "backlog-cursors");
    await mkdir(cursorDir, { recursive: true });
    await writeFile(path.join(cursorDir, "e2e.json"), "{broken", "utf8");

    await expect(readBacklogCursor("e2e", 42)).rejects.toThrow(
      "Cannot read backlog cursor",
    );
  });

  it("keeps unsafe account ids in collision-resistant cursor files", async () => {
    await writeBacklogCursor("tenant/a", 42, 10);
    await writeBacklogCursor("tenant?a", 42, 20);

    await expect(readBacklogCursor("tenant/a", 42)).resolves.toBe(10);
    await expect(readBacklogCursor("tenant?a", 42)).resolves.toBe(20);
  });

  it("fails closed when pagination does not advance", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      messages: [{ id: 5, appid: 42, message: "m5" }],
      paging: { size: 1, limit: 1, next: null, since: 5 },
    });

    await expect(
      replayBacklogForAccount({
        account: makeAccount(),
        fetchPage,
        pageLimit: 1,
        dispatch: vi.fn(),
      }),
    ).rejects.toThrow("pagination cursor did not advance");
  });

  it("bounds the in-memory replay backlog", async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      messages: [
        { id: 3, appid: 42, message: "m3" },
        { id: 2, appid: 42, message: "m2" },
      ],
      paging: { size: 2, limit: 2, next: null, since: 0 },
    });

    await expect(
      replayBacklogForAccount({
        account: makeAccount(),
        fetchPage,
        pageLimit: 2,
        maxMessages: 1,
        dispatch: vi.fn(),
      }),
    ).rejects.toThrow("safety limit of 1 messages");
  });
});

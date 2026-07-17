import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DouyinWebhookInbox,
  type DouyinWebhookInboxConfig,
} from "../src/dispatch/webhook-inbox.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

const config: DouyinWebhookInboxConfig = {
  maxPending: 10,
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 1000,
  maxDeadLetters: 10,
  maxStateBytes: 1024 * 1024,
};

async function stateDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "douyin-inbox-test-"));
  directories.push(directory);
  return directory;
}

function event(messageId: string) {
  return {
    messageId,
    rawBody: JSON.stringify({ content: { text: "hello" } }),
    text: "hello",
    peerId: "user-1",
  };
}

describe("DouyinWebhookInbox", () => {
  it("persists an event before enqueue resolves and removes it after dispatch", async () => {
    const directory = await stateDirectory();
    let finish: ((value: "dispatched") => void) | undefined;
    const dispatch = vi.fn(
      () =>
        new Promise<"dispatched">((resolve) => {
          finish = resolve;
        }),
    );
    const inbox = new DouyinWebhookInbox(
      "default",
      config,
      dispatch,
      {},
      directory,
    );
    await inbox.start();

    await expect(inbox.enqueue(event("msg-1"))).resolves.toBe("enqueued");
    const files = await import("node:fs/promises").then((fs) =>
      fs.readdir(directory),
    );
    const persisted = JSON.parse(
      await readFile(join(directory, files[0]), "utf8"),
    ) as {
      pending: Record<string, unknown>;
    };
    expect(persisted.pending).toHaveProperty("msg-1");
    expect(dispatch).toHaveBeenCalledTimes(1);

    finish?.("dispatched");
    await vi.waitFor(() => expect(inbox.status().pending).toBe(0));
    await inbox.stop();
  });

  it("restores a failed event after restart and dispatches it exactly once", async () => {
    const directory = await stateDirectory();
    const firstDispatch = vi.fn().mockResolvedValue("timed_out");
    const first = new DouyinWebhookInbox(
      "shop-a",
      config,
      firstDispatch,
      {},
      directory,
    );
    await first.start();
    await first.enqueue(event("msg-restart"));
    await vi.waitFor(() => expect(firstDispatch).toHaveBeenCalledTimes(1));
    await first.stop();

    await new Promise((resolve) => setTimeout(resolve, 120));
    const recoveredDispatch = vi.fn().mockResolvedValue("dispatched");
    const recovered = new DouyinWebhookInbox(
      "shop-a",
      config,
      recoveredDispatch,
      {},
      directory,
    );
    await recovered.start();
    await vi.waitFor(() => expect(recovered.status().pending).toBe(0));
    expect(recoveredDispatch).toHaveBeenCalledTimes(1);
    await recovered.stop();
  });

  it("moves exhausted work to a bounded DLQ", async () => {
    const directory = await stateDirectory();
    const dispatch = vi.fn().mockResolvedValue("skipped");
    const inbox = new DouyinWebhookInbox(
      "default",
      { ...config, maxAttempts: 1 },
      dispatch,
      {},
      directory,
    );
    await inbox.start();
    await inbox.enqueue(event("msg-dead"));

    await vi.waitFor(() =>
      expect(inbox.status()).toMatchObject({ pending: 0, deadLetters: 1 }),
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    dispatch.mockResolvedValue("dispatched");
    await expect(inbox.replayDeadLetters(1)).resolves.toBe(1);
    await vi.waitFor(() =>
      expect(inbox.status()).toMatchObject({ pending: 0, deadLetters: 0 }),
    );
    expect(dispatch).toHaveBeenCalledTimes(2);
    await inbox.stop();
  });
});

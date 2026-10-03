import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaimableDedupe, TranscriptDispatchError, type PersistentDedupe } from "@partme.ai/openclaw-message-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const admission = vi.hoisted(() => ({ active: 0, calls: 0 }));
const diskFaults = vi.hoisted(() => ({ inboxRenames: 0, failOn: new Set<number>() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...fs,
    rename: async (...args: Parameters<typeof fs.rename>) => {
      if (String(args[1]).includes("douyin-inbox-test-")) {
        diskFaults.inboxRenames += 1;
        if (diskFaults.failOn.has(diskFaults.inboxRenames)) {
          throw Object.assign(new Error("injected disk full"), { code: "ENOSPC" });
        }
      }
      return fs.rename(...args);
    },
  };
});
vi.mock("openclaw/plugin-sdk/webhook-request-guards", () => ({
  runDetachedWebhookWork: async (run: () => Promise<unknown>) => {
    admission.calls += 1;
    admission.active += 1;
    try {
      return await run();
    } finally {
      admission.active -= 1;
    }
  },
}));

import {
  DouyinWebhookInbox,
  type DouyinWebhookInboxConfig,
} from "../src/dispatch/webhook-inbox.js";
import { dispatchDouyinWebhookInbound } from "../src/dispatch/dispatch-inbound.js";
import { resetDouyinWebhookDedupeForTests } from "../src/dispatch/inbound-dedupe.js";
import type { ResolvedDouyinAccount } from "../src/types.js";

const directories: string[] = [];
afterEach(async () => {
  diskFaults.inboxRenames = 0;
  diskFaults.failOn.clear();
  resetDouyinWebhookDedupeForTests();
  vi.unstubAllEnvs();
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

function stateFile(directory: string): string {
  const suffix = createHash("sha256").update("default").digest("hex").slice(0, 12);
  return join(directory, `default-${suffix}.json`);
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
  it("keeps a durable completed receipt when dedupe commit only succeeds in memory", async () => {
    const directory = await stateDirectory();
    const platformSends = vi.fn();
    const diskError = Object.assign(new Error("injected dedupe EIO"), { code: "EIO" });
    const persistent: PersistentDedupe = {
      checkAndRecord: vi.fn().mockRejectedValue(diskError),
      hasRecent: vi.fn().mockResolvedValue(false),
      warmup: vi.fn().mockResolvedValue(0),
      clearMemory: vi.fn(), memorySize: vi.fn().mockReturnValue(0),
    };
    const onPersistentError = vi.fn();
    const dedupe = createClaimableDedupe({
      ttlMs: 24 * 60 * 60 * 1000, memoryMaxSize: 1_000, persistent, onPersistentError,
    });
    const dispatch = vi.fn(async (item: { messageId: string }) => {
      expect((await dedupe.claim(item.messageId)).kind).toBe("claimed");
      platformSends();
      await dedupe.commit(item.messageId);
      return "dispatched" as const;
    });
    const first = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await first.start();
    await first.enqueue(event("msg-dedupe-eio"));
    await vi.waitFor(() => expect(first.status().pending).toBe(0));
    const [file] = await import("node:fs/promises").then((fs) => fs.readdir(directory));
    const persisted = JSON.parse(await readFile(join(directory, file), "utf8"));
    expect(persisted.completed["msg-dedupe-eio"]).toEqual(expect.any(Number));
    expect(persistent.checkAndRecord).toHaveBeenCalledTimes(1);
    expect(onPersistentError).toHaveBeenCalledWith(diskError);
    await first.stop();

    dedupe.clearMemory();
    const recovered = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await recovered.start();
    expect(await recovered.enqueue(event("msg-dedupe-eio"))).toBe("duplicate");
    expect(recovered.status().pending).toBe(0);
    expect(platformSends).toHaveBeenCalledTimes(1);
    await recovered.stop();
  });

  it("expires completed receipts only after the 24-hour dedupe window", async () => {
    const directory = await stateDirectory();
    const staleAt = Date.now() - 24 * 60 * 60 * 1000 - 1;
    await writeFile(stateFile(directory), JSON.stringify({
      version: 1, pending: {}, deadLetters: [], completed: { "msg-expired": staleAt },
    }));
    const dispatch = vi.fn().mockResolvedValue("dispatched");
    const inbox = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await inbox.start();
    expect(await inbox.enqueue(event("msg-expired"))).toBe("enqueued");
    await vi.waitFor(() => expect(inbox.status().pending).toBe(0));
    expect(dispatch).toHaveBeenCalledTimes(1);
    const persisted = JSON.parse(await readFile(stateFile(directory), "utf8"));
    expect(persisted.completed["msg-expired"]).toBeGreaterThan(staleAt);
    await inbox.stop();
  });

  it("fails closed when 10k unexpired completed receipts fill capacity", async () => {
    const directory = await stateDirectory();
    const completed = Object.fromEntries(Array.from({ length: 10_000 }, (_, index) => [
      `msg-${index}`, Date.now(),
    ]));
    await writeFile(stateFile(directory), JSON.stringify({ version: 1, pending: {}, deadLetters: [], completed }));
    const dispatch = vi.fn().mockResolvedValue("dispatched");
    const inbox = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await inbox.start();
    await expect(inbox.enqueue(event("msg-over-capacity"))).rejects.toThrow("completed capacity");
    expect(inbox.status().lastError).toContain("completed capacity");
    expect(inbox.status().pending).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    expect(Object.keys(JSON.parse(await readFile(stateFile(directory), "utf8")).completed)).toHaveLength(10_000);
    await inbox.stop();

    const recovered = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await recovered.start();
    await expect(recovered.enqueue(event("msg-over-capacity"))).rejects.toThrow("completed capacity");
    expect(recovered.status().pending).toBe(0);
    expect(dispatch).not.toHaveBeenCalled();
    await recovered.stop();
  });
  it("writes processing before model execution and leaves an interrupted turn for restart review", async () => {
    const directory = await stateDirectory();
    let finish: ((result: "dispatched") => void) | undefined;
    const dispatch = vi.fn(() => new Promise<"dispatched">((resolve) => { finish = resolve; }));
    const inbox = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await inbox.start();
    await inbox.enqueue(event("msg-crash-window"));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    const [file] = await import("node:fs/promises").then((fs) => fs.readdir(directory));
    const persisted = JSON.parse(await readFile(join(directory, file), "utf8"));
    expect(persisted.pending["msg-crash-window"].processingAt).toEqual(expect.any(Number));
    finish?.("dispatched");
    await vi.waitFor(() => expect(inbox.status().pending).toBe(0));
    await inbox.stop();

    persisted.pending["msg-crash-window"].processingAt = Date.now();
    await import("node:fs/promises").then((fs) => fs.writeFile(join(directory, file), JSON.stringify(persisted)));
    const recovered = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await recovered.start();
    expect(recovered.status().pending).toBe(1);
    expect(await recovered.enqueue(event("msg-crash-window"))).toBe("duplicate");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);
    await recovered.stop();
  });

  it("does not run the model when the initial processing write fails", async () => {
    const directory = await stateDirectory();
    const dispatch = vi.fn().mockResolvedValue("dispatched");
    const inbox = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await inbox.start();
    diskFaults.failOn.add(2);
    await inbox.enqueue(event("msg-initial-eio"));
    await vi.waitFor(() => expect(String(inbox.status().lastError)).toContain("disk full"));
    expect(dispatch).not.toHaveBeenCalled();
    expect(inbox.status().pending).toBe(1);
    diskFaults.failOn.clear();
    await inbox.retryPersistence();
    await vi.waitFor(() => expect(inbox.status().pending).toBe(0));
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    await inbox.stop();
  });

  it("keeps a sent but unacknowledged reply blocked when quarantine persistence fails", async () => {
    const directory = await stateDirectory();
    const sends = vi.fn();
    const dispatch = vi.fn(async () => {
      sends();
      throw new TranscriptDispatchError(new Error("platform response lost"), "recorded");
    });
    const inbox = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await inbox.start();
    diskFaults.failOn.add(3);
    await inbox.enqueue(event("msg-reply-lost"));
    await vi.waitFor(() => expect(inbox.status().lastError).toContain("disk full"));
    expect(sends).toHaveBeenCalledTimes(1);
    expect(inbox.status().pending).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(dispatch).toHaveBeenCalledTimes(1);
    diskFaults.failOn.clear();
    await inbox.retryPersistence();
    await inbox.stop();
    const recovered = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await recovered.start();
    expect(await recovered.enqueue(event("msg-reply-lost"))).toBe("duplicate");
    expect(recovered.status().pending + recovered.status().deadLetters).toBe(1);
    expect(sends).toHaveBeenCalledTimes(1);
    await recovered.stop();
  });
  it("runs accepted Webhook work under a detached host admission after HTTP ACK", async () => {
    const directory = await stateDirectory();
    const dispatch = vi.fn(async () => {
      if (admission.active === 0) {
        throw new Error("GatewayDrainingError: inherited HTTP admission was released");
      }
      return "dispatched" as const;
    });
    const inbox = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await inbox.start();
    const callsBefore = admission.calls;

    await expect(inbox.enqueue(event("msg-admission"))).resolves.toBe("enqueued");
    await vi.waitFor(() => expect(inbox.status().pending).toBe(0));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(admission.calls).toBeGreaterThan(callsBefore);
    await inbox.stop();
  });

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
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));

    finish?.("dispatched");
    await vi.waitFor(() => expect(inbox.status().pending).toBe(0));
    await inbox.stop();
  });

  it("restores a failed event after restart and dispatches it exactly once", async () => {
    const directory = await stateDirectory();
    const firstDispatch = vi.fn().mockResolvedValue("skipped");
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

  it("quarantines an already recorded turn across restart without automatic replay", async () => {
    const directory = await stateDirectory();
    const dispatch = vi.fn().mockRejectedValue(new TranscriptDispatchError(new Error("host failed"), "recorded"));
    const first = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await first.start();
    await first.enqueue(event("msg-recorded"));
    await vi.waitFor(() => expect(first.status()).toMatchObject({ pending: 0, deadLetters: 1 }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    await first.stop();

    const recovered = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await recovered.start();
    expect(recovered.status()).toMatchObject({ pending: 0, deadLetters: 1 });
    expect(await recovered.enqueue(event("msg-recorded"))).toBe("duplicate");
    expect(await recovered.replayDeadLetters(1)).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await recovered.stop();
  });

  it("quarantines an unclassified dispatch error instead of replaying an uncertain turn", async () => {
    const directory = await stateDirectory();
    const dispatch = vi.fn().mockRejectedValue(new Error("unknown host phase"));
    const inbox = new DouyinWebhookInbox("default", config, dispatch, {}, directory);
    await inbox.start();
    await inbox.enqueue(event("msg-unknown"));
    await vi.waitFor(() => expect(inbox.status()).toMatchObject({ pending: 0, deadLetters: 1 }));
    expect(await inbox.replayDeadLetters(1)).toBe(0);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await inbox.stop();
  });

  it("does not commit dedupe after a deferred host record error and quarantines the single user turn", async () => {
    const directory = await stateDirectory();
    vi.stubEnv("OPENCLAW_STATE_DIR", directory);
    resetDouyinWebhookDedupeForTests();
    const messageId = `msg-meta-${process.pid}-${Date.now()}`;
    const recordInboundSession = vi.fn(async (recordParams) => {
      const task = Promise.resolve().then(() => recordParams.onRecordError(new Error("metadata write uncertain")));
      recordParams.trackSessionMetaTask(task);
    });
    const runtime = {
      channel: {
        routing: { resolveAgentRoute: () => ({ sessionKey: "agent:main:douyin:direct:user-1", agentId: "main" }) },
        session: { resolveStorePath: () => join(directory, "session.json"), recordInboundSession },
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn(), finalizeInboundContext: (ctx: unknown) => ctx },
        inbound: { dispatchReply: vi.fn(async (turn) => {
          await turn.recordInboundSession({
            storePath: turn.storePath, sessionKey: turn.routeSessionKey, ctx: turn.ctxPayload,
            onRecordError: turn.record.onRecordError,
            trackSessionMetaTask: turn.record.trackSessionMetaTask,
          });
          return { admission: { kind: "dispatch" }, dispatched: true };
        }) },
      },
    } as unknown as PluginRuntime;
    const account = {
      accountId: `meta-${process.pid}-${Date.now()}`, enabled: true, configured: true,
      app_key: "k", app_secret: "s", shop_id: "shop-1", webhook_path: "/channels/douyin/webhook",
      config: { app_key: "k", app_secret: "s" },
    } as ResolvedDouyinAccount;
    const dispatch = vi.fn(async (item: ReturnType<typeof event>) => dispatchDouyinWebhookInbound({
      runtime, cfg: {}, account, rawBody: item.rawBody, text: item.text,
      peerId: item.peerId, messageId: item.messageId,
    }));
    const inbox = new DouyinWebhookInbox(account.accountId, config, dispatch, {}, directory);
    await inbox.start();
    await inbox.enqueue(event(messageId));
    await vi.waitFor(() => expect(inbox.status()).toMatchObject({ pending: 0, deadLetters: 1 }));
    expect(inbox.status().lastError).toContain("metadata write uncertain");
    expect(recordInboundSession).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(await inbox.replayDeadLetters(1)).toBe(0);
    await inbox.stop();
  });
});

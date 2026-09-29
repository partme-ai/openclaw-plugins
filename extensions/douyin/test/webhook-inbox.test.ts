import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TranscriptDispatchError } from "@partme.ai/openclaw-message-sdk";
import type { PluginRuntime } from "openclaw/plugin-sdk/core";

const admission = vi.hoisted(() => ({ active: 0, calls: 0 }));
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

function event(messageId: string) {
  return {
    messageId,
    rawBody: JSON.stringify({ content: { text: "hello" } }),
    text: "hello",
    peerId: "user-1",
  };
}

describe("DouyinWebhookInbox", () => {
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

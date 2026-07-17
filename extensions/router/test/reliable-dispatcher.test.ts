import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CommittedPersistenceError, DurableRouteStore } from "../src/durable-store.js";
import { ReliableRouteDispatcher, stableDeliveryKey } from "../src/reliable-dispatcher.js";
import type { RouterConfig } from "../src/types.js";

const directories: string[] = [];

function config(overrides: Partial<RouterConfig["delivery"]> = {}): RouterConfig {
  return {
    enabled: true,
    rules: [],
    audit: { enabled: true, logToConsole: false, maxEntries: 100 },
    delivery: {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 20,
      backoffMultiplier: 1,
      jitter: 0,
      dedupeTtlMs: 60_000,
      maxDeliveredKeys: 100,
      maxDeadLetters: 100,
      maxPendingTasks: 100,
      maxPayloadBytes: 1024 * 1024,
      maxHops: 8,
      publishTimeoutMs: 100,
      concurrency: 2,
      lockHeartbeatMs: 50,
      lockTimeoutMs: 500,
      ...overrides,
    },
  };
}

function api() {
  return {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never;
}

async function stateDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openclaw-router-test-"));
  directories.push(directory);
  return directory;
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timeout");
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ReliableRouteDispatcher", () => {
  it("commits only after publish succeeds and suppresses a persisted duplicate", async () => {
    const directory = await stateDir();
    const resolved = config();
    const publish = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, new DurableRouteStore(directory, resolved), publish);
    await dispatcher.start();
    const request = {
      dedupeKey: stableDeliveryKey({ messageId: "m-1", rule: "r-1" }),
      ruleId: "r-1",
      actionType: "forward" as const,
      payload: { channel: "mqtt", content: "hello" },
    };
    await expect(dispatcher.enqueue(request)).resolves.toBe("enqueued");
    await expect(dispatcher.enqueue(request)).resolves.toBe("duplicate");
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await dispatcher.status()).toMatchObject({ pending: 0, delivered: 1, duplicates: 1 });
    await dispatcher.stop();

    const restarted = new ReliableRouteDispatcher(api(), resolved, new DurableRouteStore(directory, resolved), publish);
    await restarted.start();
    await expect(restarted.enqueue(request)).resolves.toBe("duplicate");
    expect(publish).toHaveBeenCalledTimes(1);
    await restarted.stop();
  });

  it("retries with backoff and moves an exhausted task to the durable DLQ", async () => {
    const directory = await stateDir();
    const resolved = config({ maxAttempts: 2 });
    const publish = vi.fn().mockRejectedValue(new Error("broker unavailable"));
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, new DurableRouteStore(directory, resolved), publish);
    await dispatcher.start();
    await dispatcher.enqueue({
      dedupeKey: "failed-task",
      ruleId: "r-1",
      actionType: "forward",
      payload: { channel: "rabbitmq", content: "hello" },
    });
    await waitFor(async () => (await dispatcher.deadLetters(10)).length === 1);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(await dispatcher.status()).toMatchObject({ pending: 0, deadLetters: 1, retries: 1 });
    await dispatcher.stop();
  });

  it("replays dead letters on operator request", async () => {
    const directory = await stateDir();
    const resolved = config({ maxAttempts: 1 });
    const publish = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(undefined);
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, new DurableRouteStore(directory, resolved), publish);
    await dispatcher.start();
    await dispatcher.enqueue({
      dedupeKey: "replay-task",
      ruleId: "r-1",
      actionType: "reply-via",
      payload: { channel: "wecom", content: "hello" },
    });
    await waitFor(async () => (await dispatcher.deadLetters(10)).length === 1);
    await expect(dispatcher.replayDeadLetters(10)).resolves.toBe(1);
    await waitFor(async () => (await dispatcher.status()).delivered === 1);
    expect(await dispatcher.deadLetters(10)).toHaveLength(0);
    await dispatcher.stop();
  });

  it("persists every fan-out action atomically before starting delivery", async () => {
    const directory = await stateDir();
    const resolved = config();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const publish = vi.fn(() => blocked);
    const store = new DurableRouteStore(directory, resolved);
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, store, publish);
    await dispatcher.start();
    await dispatcher.enqueueBatch(["one", "two"].map((dedupeKey) => ({
      dedupeKey, ruleId: "fanout", actionType: "forward" as const,
      payload: { channel: "mqtt", to: `topic/${dedupeKey}`, content: "hello" },
    })));
    await waitFor(async () => publish.mock.calls.length === 2);
    expect(await store.snapshot()).toMatchObject({ pending: 2 });
    release();
    await waitFor(async () => (await dispatcher.status()).delivered === 2);
    await dispatcher.stop();
  });

  it("times out a hung target and reaches DLQ without freezing shutdown", async () => {
    const directory = await stateDir();
    const resolved = config({ maxAttempts: 1, publishTimeoutMs: 20 });
    const publish = vi.fn(() => new Promise<void>(() => undefined));
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, new DurableRouteStore(directory, resolved), publish);
    await dispatcher.start();
    await dispatcher.enqueue({ dedupeKey: "hung", ruleId: "r", actionType: "forward", payload: { channel: "mqtt", content: "hello" } });
    await waitFor(async () => (await dispatcher.status()).deadLetters === 1);
    await expect(dispatcher.stop()).resolves.toBeUndefined();
  });

  it("keeps a rename-committed delivery out of retry when directory durability is uncertain", async () => {
    const directory = await stateDir();
    const resolved = config();
    const store = new DurableRouteStore(directory, resolved);
    const originalMarkDelivered = store.markDelivered.bind(store);
    vi.spyOn(store, "markDelivered").mockImplementationOnce(async (task) => {
      await originalMarkDelivered(task);
      throw new CommittedPersistenceError(new Error("injected directory fsync failure"));
    });
    const markFailed = vi.spyOn(store, "markFailed");
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, store, vi.fn().mockResolvedValue(undefined));
    await dispatcher.start();
    await dispatcher.enqueue({
      dedupeKey: "committed-uncertain",
      ruleId: "r",
      actionType: "forward",
      payload: { channel: "mqtt", content: "hello" },
    });
    await waitFor(async () => (await dispatcher.status()).durabilityUncertain);
    expect(markFailed).not.toHaveBeenCalled();
    expect(await dispatcher.status()).toMatchObject({
      pending: 0,
      delivered: 1,
      healthy: false,
      durabilityUncertain: true,
    });
    await dispatcher.stop();
  });

  it("fails fast when a second writer opens the same state directory", async () => {
    const directory = await stateDir();
    const resolved = config();
    const first = new DurableRouteStore(directory, resolved);
    const second = new DurableRouteStore(directory, resolved);
    await first.initialize();
    await expect(second.initialize()).rejects.toThrow("active writer");
    await first.close();
    await expect(second.initialize()).resolves.toBeUndefined();
    await second.close();
  });

  it("reclaims a timed-out writer lease left by another host", async () => {
    const directory = await stateDir();
    const lockDirectory = join(directory, ".writer.lock");
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(join(lockDirectory, "owner.json"), JSON.stringify({
      token: "dead-remote-writer",
      pid: 123,
      hostname: "another-gateway-host",
      startedAt: Date.now() - 60_000,
      heartbeatAt: Date.now() - 60_000,
    }));

    const store = new DurableRouteStore(directory, config({ lockTimeoutMs: 500 }));
    await expect(store.initialize()).resolves.toBeUndefined();
    await store.close();
  });
});

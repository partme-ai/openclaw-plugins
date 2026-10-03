import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CommittedPersistenceError, DurableRouteStore } from "../src/durable-store.js";
import { ReliableRouteDispatcher, stableDeliveryKey } from "../src/reliable-dispatcher.js";
import type { RouterConfig } from "../src/types.js";
import { onInternalDiagnosticEvent, waitForDiagnosticEventsDrained } from "openclaw/plugin-sdk/diagnostic-runtime";

const directories: string[] = [];

function config(overrides: Partial<RouterConfig["delivery"]> = {}): RouterConfig {
  return {
    enabled: true,
    rules: [],
    audit: { enabled: true, logToConsole: false, maxEntries: 100 },
    delivery: {
      statePreviousEncryptionKeyEnvs: [],
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
  delete process.env.ROUTER_TEST_STATE_KEY;
  delete process.env.ROUTER_TEST_OLD_STATE_KEY;
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ReliableRouteDispatcher", () => {
  it("does not start a zombie timer or retain the lease when stop overtakes initialization", async () => {
    const directory = await stateDir();
    const resolved = config();
    const store = new DurableRouteStore(directory, resolved);
    const initialized = Promise.withResolvers<void>();
    const releaseStart = Promise.withResolvers<void>();
    const initialize = store.initialize.bind(store);
    vi.spyOn(store, "initialize").mockImplementationOnce(async () => {
      await initialize();
      initialized.resolve();
      await releaseStart.promise;
    });
    const events: number[] = [];
    const unsubscribe = onInternalDiagnosticEvent((event) => {
      if (event.type === "log.record" && event.loggerName === "partme.delivery-recall.v1" &&
          event.attributes?.event === "dlq") events.push(event.attributes.entries as number);
    });
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, store, vi.fn(), 20);
    try {
      const starting = dispatcher.start();
      await initialized.promise;
      const stopping = dispatcher.stop();
      releaseStart.resolve();
      await Promise.all([starting, stopping]);
      expect((await dispatcher.status()).running).toBe(false);
      const replacement = new DurableRouteStore(directory, resolved);
      await expect(replacement.initialize()).resolves.toBeUndefined();
      await replacement.close();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await waitForDiagnosticEventsDrained();
      expect(events).toEqual([]);
    } finally {
      releaseStart.resolve();
      unsubscribe();
      await dispatcher.stop();
    }
  });
  it("starts a new generation after a concurrent stop releases its writer lease", async () => {
    const directory = await stateDir();
    const resolved = config();
    const store = new DurableRouteStore(directory, resolved);
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, store, vi.fn(), 20);
    await dispatcher.start();
    const closing = Promise.withResolvers<void>();
    const releaseClose = Promise.withResolvers<void>();
    const close = store.close.bind(store);
    vi.spyOn(store, "close").mockImplementationOnce(async () => {
      await close();
      closing.resolve();
      await releaseClose.promise;
    });
    const stopping = dispatcher.stop();
    await closing.promise;
    const initialize = vi.spyOn(store, "initialize");
    const restarting = dispatcher.start();
    await Promise.resolve();
    expect(initialize).not.toHaveBeenCalled();
    releaseClose.resolve();
    await Promise.all([stopping, restarting]);
    expect((await dispatcher.status()).running).toBe(true);
    await dispatcher.stop();
    const replacement = new DurableRouteStore(directory, resolved);
    await expect(replacement.initialize()).resolves.toBeUndefined();
    await replacement.close();
  });
  it("reobserves durable DLQ depth after a metrics subscriber resets without a Router transition", async () => {
    const directory = await stateDir();
    const resolved = config({ lockHeartbeatMs: 60_000 });
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, new DurableRouteStore(directory, resolved), vi.fn(), 20);
    const first: number[] = [];
    const second: number[] = [];
    const subscribe = (target: number[]) => onInternalDiagnosticEvent((event) => {
      if (event.type === "log.record" && event.loggerName === "partme.delivery-recall.v1" &&
          event.attributes?.event === "dlq") target.push(event.attributes.entries as number);
    });
    const stopFirst = subscribe(first);
    await dispatcher.start();
    await waitForDiagnosticEventsDrained();
    expect(first).toEqual([0]);
    stopFirst();
    const stopSecond = subscribe(second);
    try {
      await waitFor(async () => second.length > 0);
      await waitForDiagnosticEventsDrained();
      expect(second).toEqual([0]);
      await dispatcher.stop();
      await new Promise((resolve) => setTimeout(resolve, 50));
      await waitForDiagnosticEventsDrained();
      expect(second).toEqual([0]);
    } finally {
      stopSecond();
      await dispatcher.stop();
    }
  });
  it("records retry then delivered once and classifies an exhausted timeout as ambiguous", async () => {
    const events: Array<{ attributes?: Record<string, unknown> }> = [];
    const stop = onInternalDiagnosticEvent((event) => {
      if (event.type === "log.record" && event.loggerName === "partme.delivery-recall.v1") events.push(event);
    });
    try {
      const firstDir = await stateDir();
      const firstConfig = config({ maxAttempts: 2 });
      const publish = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
      const first = new ReliableRouteDispatcher(api(), firstConfig, new DurableRouteStore(firstDir, firstConfig), publish);
      await first.start();
      await first.enqueue({ dedupeKey: "retry-success", ruleId: "r", actionType: "forward",
        payload: { channel: "mqtt", content: "hello" } });
      await waitFor(async () => (await first.status()).delivered === 1);
      await first.stop();

      const secondDir = await stateDir();
      const secondConfig = config({ maxAttempts: 1, publishTimeoutMs: 10 });
      const second = new ReliableRouteDispatcher(api(), secondConfig, new DurableRouteStore(secondDir, secondConfig),
        () => new Promise<void>(() => {}));
      await second.start();
      await second.enqueue({ dedupeKey: "unknown-final", ruleId: "r", actionType: "forward",
        payload: { channel: "mqtt", content: "hello" } });
      await waitFor(async () => (await second.deadLetters(10)).length === 1);
      await second.stop();
      await waitForDiagnosticEventsDrained();
      const facts = events.map((event) => event.attributes);
      expect(facts.filter((fact) => fact?.event === "retry" && fact?.channel === "router")).toHaveLength(1);
      expect(facts.filter((fact) => fact?.event === "settlement" && fact?.outcome === "delivered")).toHaveLength(1);
      expect(facts.filter((fact) => fact?.event === "settlement" && fact?.outcome === "ambiguous")).toHaveLength(1);
      expect(facts.filter((fact) => fact?.event === "settlement" && fact?.outcome === "failed")).toHaveLength(0);
      expect(facts.filter((fact) => fact?.event === "dlq" && fact?.entries === 1)).toHaveLength(1);
    } finally {
      stop();
    }
  });
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
    expect(await dispatcher.status()).toMatchObject({
      pending: 0,
      delivered: 1,
      deliveredKeys: 1,
      duplicates: 1,
    });
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

  it("脱敏状态、日志、持久 DLQ 与审计中的目标 adapter 凭据", async () => {
    const directory = await stateDir();
    const resolved = config({ maxAttempts: 1 });
    const pluginApi = api() as { logger: { error: ReturnType<typeof vi.fn> } };
    const secret = "router-production-secret";
    const publish = vi.fn().mockRejectedValue(new Error(
      `POST https://user:password@target.example/send?access_token=${secret} Authorization: Bearer ${secret}`,
    ));
    const dispatcher = new ReliableRouteDispatcher(pluginApi as never, resolved, new DurableRouteStore(directory, resolved), publish);
    await dispatcher.start();
    await dispatcher.enqueue({
      dedupeKey: "redacted-failure",
      ruleId: "redaction-rule",
      actionType: "forward",
      payload: { channel: "gotify", content: "hello" },
    });
    await waitFor(async () => (await dispatcher.deadLetters(10)).length === 1);

    const evidence = JSON.stringify({
      status: await dispatcher.status(),
      deadLetters: await dispatcher.deadLetters(10),
      audit: await dispatcher.auditEntries(10),
      logs: pluginApi.logger.error.mock.calls,
    });
    expect(evidence).not.toMatch(/router-production-secret|user:password/);
    expect(evidence).toContain("[REDACTED]");
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

  it("replays a committed DLQ entry when the telemetry depth snapshot fails", async () => {
    const directory = await stateDir();
    const resolved = config({ maxAttempts: 1 });
    const store = new DurableRouteStore(directory, resolved);
    const publish = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue(undefined);
    const pluginApi = api() as { logger: { error: ReturnType<typeof vi.fn> } };
    const dispatcher = new ReliableRouteDispatcher(pluginApi as never, resolved, store, publish);
    await dispatcher.start();
    await dispatcher.enqueue({ dedupeKey: "replay-snapshot-error", ruleId: "r", actionType: "forward",
      payload: { channel: "mqtt", content: "hello" } });
    await waitFor(async () => (await dispatcher.deadLetters(10)).length === 1);
    const replay = store.replayDeadLetters.bind(store);
    vi.spyOn(store, "replayDeadLetters").mockImplementation(async (limit) => {
      const count = await replay(limit);
      vi.spyOn(store, "snapshot").mockRejectedValueOnce(new Error("telemetry snapshot failed"));
      return count;
    });
    pluginApi.logger.error.mockImplementationOnce(() => { throw new Error("logger unavailable"); });
    await expect(dispatcher.replayDeadLetters(10)).resolves.toBe(1);
    await waitFor(async () => (await dispatcher.status()).delivered === 1);
    expect(await dispatcher.deadLetters(10)).toHaveLength(0);
    await dispatcher.stop();
  });

  it("completes exhausted delivery bookkeeping when the DLQ telemetry snapshot fails", async () => {
    const directory = await stateDir();
    const resolved = config({ maxAttempts: 1 });
    const store = new DurableRouteStore(directory, resolved);
    const markFailed = store.markFailed.bind(store);
    vi.spyOn(store, "markFailed").mockImplementation(async (...args) => {
      const result = await markFailed(...args);
      if (result === "dead-letter") vi.spyOn(store, "snapshot").mockRejectedValueOnce(new Error("telemetry snapshot failed"));
      return result;
    });
    const pluginApi = api() as { logger: { error: ReturnType<typeof vi.fn> } };
    const dispatcher = new ReliableRouteDispatcher(pluginApi as never, resolved, store,
      vi.fn().mockRejectedValue(new Error("permanent")));
    await dispatcher.start();
    await dispatcher.enqueue({ dedupeKey: "failed-snapshot-error", ruleId: "r", actionType: "forward",
      payload: { channel: "mqtt", content: "hello" } });
    await waitFor(async () => (await dispatcher.deadLetters(10)).length === 1);
    await waitFor(async () => pluginApi.logger.error.mock.calls.some(([line]) => String(line).includes("delivery exhausted")));
    expect(await dispatcher.status()).toMatchObject({ pending: 0, deadLetters: 1 });
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

  it("releases the writer lease when startup cannot publish", async () => {
    const directory = await stateDir();
    const resolved = config();
    const failed = new ReliableRouteDispatcher(
      api(),
      resolved,
      new DurableRouteStore(directory, resolved),
      undefined,
    );
    await expect(failed.start()).rejects.toThrow("send capability is unavailable");

    const replacement = new DurableRouteStore(directory, resolved);
    await expect(replacement.initialize()).resolves.toBeUndefined();
    await replacement.close();
  });

  it("releases the startup writer lease even when the telemetry snapshot fails", async () => {
    const directory = await stateDir();
    const resolved = config();
    const store = new DurableRouteStore(directory, resolved);
    vi.spyOn(store, "snapshot").mockRejectedValueOnce(new Error("telemetry snapshot failed"));
    const failed = new ReliableRouteDispatcher(api(), resolved, store, undefined);
    await expect(failed.start()).rejects.toThrow("send capability is unavailable");
    const replacement = new DurableRouteStore(directory, resolved);
    await expect(replacement.initialize()).resolves.toBeUndefined();
    await replacement.close();
  });

  it("recovers pending work after a transient background store read failure", async () => {
    const directory = await stateDir();
    const resolved = config();
    const seed = new DurableRouteStore(directory, resolved);
    await seed.enqueue({
      id: "recover-after-read-error",
      dedupeKey: "recover-after-read-error",
      ruleId: "r",
      actionType: "forward",
      payload: { channel: "mqtt", content: "hello" },
      attempts: 0,
      createdAt: Date.now(),
      nextAttemptAt: Date.now(),
    });
    await seed.close();

    const store = new DurableRouteStore(directory, resolved);
    const originalDue = store.due.bind(store);
    vi.spyOn(store, "due")
      .mockRejectedValueOnce(new Error("temporary state read failure"))
      .mockImplementation(originalDue);
    const publish = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new ReliableRouteDispatcher(api(), resolved, store, publish);
    await dispatcher.start();
    await waitFor(async () => (await dispatcher.status()).delivered === 1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(await dispatcher.status()).toMatchObject({
      pending: 0,
      healthy: true,
      storeErrors: 1,
    });
    await dispatcher.stop();
  });

  it("returns an unhealthy low-sensitivity status when the store snapshot is unavailable", async () => {
    const directory = await stateDir();
    const resolved = config();
    const store = new DurableRouteStore(directory, resolved);
    const dispatcher = new ReliableRouteDispatcher(
      api(),
      resolved,
      store,
      vi.fn().mockResolvedValue(undefined),
    );
    await dispatcher.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.spyOn(store, "snapshot").mockRejectedValueOnce(
      new Error("disk failed Authorization: Bearer should-not-leak"),
    );
    await expect(dispatcher.status()).resolves.toMatchObject({
      healthy: false,
      storeErrors: 1,
      lastError: expect.stringContaining("[REDACTED]"),
    });
    await expect(dispatcher.status()).resolves.toMatchObject({
      healthy: true,
      storeErrors: 1,
      lastError: null,
    });
    await dispatcher.stop();
  });

  it("throttles repeated identical storage errors from health polling", async () => {
    const directory = await stateDir();
    const resolved = config();
    const store = new DurableRouteStore(directory, resolved);
    const pluginApi = api() as { logger: { error: ReturnType<typeof vi.fn> } };
    const dispatcher = new ReliableRouteDispatcher(
      pluginApi as never,
      resolved,
      store,
      vi.fn().mockResolvedValue(undefined),
    );
    await dispatcher.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    vi.spyOn(store, "snapshot").mockRejectedValue(new Error("same disk failure"));
    await dispatcher.status();
    await expect(dispatcher.status()).resolves.toMatchObject({
      healthy: false,
      storeErrors: 2,
    });
    expect(pluginApi.logger.error).toHaveBeenCalledTimes(1);
    await dispatcher.stop();
  });

  it("encrypts message state at rest and rotates from a previous key", async () => {
    const directory = await stateDir();
    const oldKey = Buffer.alloc(32, 1).toString("base64");
    const newKey = Buffer.alloc(32, 2).toString("base64");
    process.env.ROUTER_TEST_STATE_KEY = oldKey;
    const oldConfig = config({
      stateEncryptionKeyEnv: "ROUTER_TEST_STATE_KEY",
      statePreviousEncryptionKeyEnvs: [],
    });
    const first = new DurableRouteStore(directory, oldConfig);
    await first.enqueue({
      id: "encrypted-task",
      dedupeKey: "encrypted-task",
      ruleId: "r",
      actionType: "reply-via",
      payload: { channel: "wecom", to: "sensitive-recipient", content: "sensitive-message-body" },
      attempts: 0,
      createdAt: Date.now(),
      nextAttemptAt: Date.now(),
    });
    await first.close();
    const encrypted = await readFile(join(directory, "delivery-state.json"), "utf8");
    expect(encrypted).toContain('"algorithm":"aes-256-gcm"');
    expect(encrypted).not.toMatch(/sensitive-message-body|sensitive-recipient/u);

    process.env.ROUTER_TEST_OLD_STATE_KEY = oldKey;
    process.env.ROUTER_TEST_STATE_KEY = newKey;
    const rotatedConfig = config({
      stateEncryptionKeyEnv: "ROUTER_TEST_STATE_KEY",
      statePreviousEncryptionKeyEnvs: ["ROUTER_TEST_OLD_STATE_KEY"],
    });
    const rotated = new DurableRouteStore(directory, rotatedConfig);
    await rotated.initialize();
    expect(await rotated.snapshot()).toMatchObject({ pending: 1 });
    await rotated.close();

    delete process.env.ROUTER_TEST_OLD_STATE_KEY;
    const currentOnly = new DurableRouteStore(
      directory,
      config({
        stateEncryptionKeyEnv: "ROUTER_TEST_STATE_KEY",
        statePreviousEncryptionKeyEnvs: [],
      }),
    );
    await expect(currentOnly.initialize()).resolves.toBeUndefined();
    expect(await currentOnly.snapshot()).toMatchObject({ pending: 1 });
    await currentOnly.close();
  });

  it("fails closed when encrypted state has no matching key", async () => {
    const directory = await stateDir();
    process.env.ROUTER_TEST_STATE_KEY = Buffer.alloc(32, 3).toString("base64");
    const encryptedConfig = config({
      stateEncryptionKeyEnv: "ROUTER_TEST_STATE_KEY",
      statePreviousEncryptionKeyEnvs: [],
    });
    const first = new DurableRouteStore(directory, encryptedConfig);
    await first.enqueue({
      id: "encrypted-task",
      dedupeKey: "encrypted-task",
      ruleId: "r",
      actionType: "forward",
      payload: { channel: "mqtt", content: "secret" },
      attempts: 0,
      createdAt: Date.now(),
      nextAttemptAt: Date.now(),
    });
    await first.close();

    process.env.ROUTER_TEST_STATE_KEY = Buffer.alloc(32, 4).toString("base64");
    const wrongKey = new DurableRouteStore(directory, encryptedConfig);
    await expect(wrongKey.initialize()).rejects.toThrow("no configured state encryption key");
  });
});

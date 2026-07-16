import { createHash, randomUUID } from "node:crypto";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import { CommittedPersistenceError, DurableRouteStore, type RouteAuditEntry } from "./durable-store.js";
import type { PublishInboundParams, RouteAction, RouteDeliveryTask, RouterConfig } from "./types.js";

export type ReliableDispatcherStatus = {
  running: boolean;
  accepted: number;
  duplicates: number;
  delivered: number;
  retries: number;
  deadLetters: number;
  pending: number;
  oldestPendingAt: number | null;
  nextAttemptAt: number | null;
  inflight: number;
  healthy: boolean;
  lastError: string | null;
  lastErrorAt: number | null;
  unknownOutcomes: number;
  durabilityUncertain: boolean;
};

type PublishInboundFn = (params: PublishInboundParams, signal?: AbortSignal) => void | Promise<void>;
type EnqueueParams = {
  dedupeKey: string;
  ruleId: string;
  actionType: RouteAction["type"];
  payload: PublishInboundParams;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function stableDeliveryKey(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export class ReliableRouteDispatcher {
  private running = false;
  private drainPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | undefined;
  private counters = { accepted: 0, duplicates: 0, delivered: 0, retries: 0, deadLetters: 0, unknownOutcomes: 0 };
  private inflight = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private durabilityUncertain = false;

  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly config: RouterConfig,
    private readonly store: DurableRouteStore,
    private readonly publish: PublishInboundFn | undefined,
  ) {}

  async start(): Promise<void> {
    await this.store.initialize();
    if (!this.publish) throw new Error("[router] Gateway send capability is unavailable");
    this.running = true;
    this.wake();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    await this.drainPromise;
    await this.store.close();
  }

  async enqueue(params: EnqueueParams): Promise<"enqueued" | "duplicate"> {
    const result = await this.enqueueBatch([params]);
    return result.enqueued === 1 ? "enqueued" : "duplicate";
  }

  async enqueueBatch(params: EnqueueParams[]): Promise<{ enqueued: number; duplicates: number }> {
    const now = Date.now();
    const tasks = params.map((item): RouteDeliveryTask => {
      const fallbackKey = randomUUID();
      return {
        id: item.dedupeKey || fallbackKey,
        dedupeKey: item.dedupeKey || fallbackKey,
        ruleId: item.ruleId,
        actionType: item.actionType,
        payload: item.payload,
        attempts: 0,
        createdAt: now,
        nextAttemptAt: now,
      };
    });
    const result = await this.store.enqueueBatch(tasks);
    this.counters.accepted += result.enqueued;
    this.counters.duplicates += result.duplicates;
    if (result.enqueued > 0) this.wake();
    return result;
  }

  async replayDeadLetters(limit: number): Promise<number> {
    const count = await this.store.replayDeadLetters(limit);
    if (count > 0) this.wake();
    return count;
  }

  async ownsIdentity(identity: string | undefined): Promise<boolean> {
    return identity ? this.store.ownsIdentity(identity) : false;
  }

  async status(): Promise<ReliableDispatcherStatus> {
    const snapshot = await this.store.snapshot();
    if (!this.durabilityUncertain && snapshot.pending === 0 && snapshot.deadLetters === 0 && this.inflight === 0) {
      this.lastError = null;
      this.lastErrorAt = null;
    }
    const healthy = this.running && snapshot.deadLetters === 0 && this.lastError === null && !this.durabilityUncertain;
    return {
      running: this.running,
      ...this.counters,
      deadLetters: snapshot.deadLetters,
      pending: snapshot.pending,
      oldestPendingAt: snapshot.oldestPendingAt,
      nextAttemptAt: snapshot.nextAttemptAt,
      inflight: this.inflight,
      healthy,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      durabilityUncertain: this.durabilityUncertain,
    };
  }

  async deadLetters(limit: number): Promise<RouteDeliveryTask[]> {
    return this.store.deadLetters(limit);
  }

  async auditEntries(limit: number): Promise<RouteAuditEntry[]> {
    return this.store.auditEntries(limit);
  }

  private wake(): void {
    if (!this.running || this.drainPromise) return;
    this.drainPromise = this.runDrain().finally(() => {
      this.drainPromise = null;
      if (this.running) void this.scheduleNext();
    });
    void this.drainPromise.catch((error: unknown) => {
      this.api.logger.error(`[router] background delivery drain failed: ${errorMessage(error)}`);
    });
  }

  private async runDrain(): Promise<void> {
    while (this.running) {
      const tasks = await this.store.due(Date.now(), this.config.delivery.concurrency);
      if (tasks.length === 0) break;
      await Promise.all(tasks.map((task) => this.processTask(task)));
    }
  }

  private async processTask(task: RouteDeliveryTask): Promise<void> {
    this.inflight += 1;
    try {
      if (!this.publish) throw new Error("Gateway send capability is unavailable");
      await this.withTimeout(
        (signal) => Promise.resolve(this.publish?.(task.payload, signal)),
        this.config.delivery.publishTimeoutMs,
      );
      try {
        await this.store.markDelivered(task);
      } catch (error) {
        if (!(error instanceof CommittedPersistenceError)) throw error;
        this.durabilityUncertain = true;
        this.lastError = errorMessage(error);
        this.lastErrorAt = Date.now();
        this.counters.delivered += 1;
        this.api.logger.error(`[router] delivery committed with uncertain directory durability task=${task.id}: ${this.lastError}`);
        return;
      }
      this.counters.delivered += 1;
      if (this.config.audit.logToConsole) this.api.logger.info(`[router] delivered task=${task.id} rule=${task.ruleId} target=${task.payload.channel}`);
    } catch (error) {
      this.lastError = errorMessage(error);
      this.lastErrorAt = Date.now();
      if (error instanceof Error && error.name === "RouterDeliveryTimeoutError") this.counters.unknownOutcomes += 1;
      const attempts = task.attempts + 1;
      const dead = attempts >= this.config.delivery.maxAttempts;
      const nextAttemptAt = dead ? null : Date.now() + this.retryDelay(attempts);
      const outcome = await this.store.markFailed(task, errorMessage(error), nextAttemptAt);
      if (outcome === "dead-letter") {
        this.counters.deadLetters += 1;
        this.api.logger.error(`[router] delivery exhausted task=${task.id} rule=${task.ruleId}: ${errorMessage(error)}`);
      } else {
        this.counters.retries += 1;
        this.api.logger.warn(`[router] delivery ${outcome === "blocked" ? "blocked by full DLQ" : `retry ${attempts}/${this.config.delivery.maxAttempts}`} task=${task.id}: ${errorMessage(error)}`);
      }
    } finally {
      this.inflight -= 1;
    }
  }

  private async withTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const controller = new AbortController();
    try {
      return await Promise.race([
        operation(controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            const error = new Error(`delivery timed out after ${timeoutMs}ms; outcome is unknown`);
            error.name = "RouterDeliveryTimeoutError";
            reject(error);
          }, timeoutMs);
          timer.unref();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private retryDelay(attempt: number): number {
    const base = Math.min(
      this.config.delivery.maxDelayMs,
      this.config.delivery.initialDelayMs * this.config.delivery.backoffMultiplier ** Math.max(0, attempt - 1),
    );
    const spread = base * this.config.delivery.jitter;
    return Math.max(10, Math.floor(base - spread + Math.random() * spread * 2));
  }

  private async scheduleNext(): Promise<void> {
    if (!this.running) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    const snapshot = await this.store.snapshot();
    if (snapshot.nextAttemptAt === null) return;
    const delay = Math.max(10, snapshot.nextAttemptAt - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.wake();
    }, delay);
    this.retryTimer.unref();
  }
}

/**
 * @fileoverview Router 的持久化队列消费、有限并发、超时重试和死信调度器。
 *
 * 消息先写入 `DurableRouteStore` 再发送，成功后提交 delivered 去重键；失败采用指数退避与
 * 抖动，达到上限进入 DLQ。发布超时被标记为“结果未知”，目录 fsync 失败被标记为“持久性
 * 不确定”，两类情况都会降低健康状态，避免把无法证明的投递结果误报为完全成功。
 */
import { createHash, randomUUID } from "node:crypto";

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";

import {
  CommittedPersistenceError,
  DurableRouteStore,
  type RouteAuditEntry,
  type RouteStoreSnapshot,
} from "./durable-store.js";
import { redactRouterError } from "./redact.js";
import type { PublishInboundParams, RouteAction, RouteDeliveryTask, RouterConfig } from "./types.js";

/**
 * 可靠投递器的实时健康与积压快照。
 *
 * unknownOutcomes 表示超时后目标可能已收到消息，durabilityUncertain 表示 rename 后目录 fsync
 * 失败；任一状态都不能被误报为健康。
 */
export type ReliableDispatcherStatus = {
  running: boolean;
  accepted: number;
  duplicates: number;
  delivered: number;
  retries: number;
  deadLetters: number;
  pending: number;
  /** 当前仍在 TTL 内的持久成功幂等键数量。 */
  deliveredKeys: number;
  oldestPendingAt: number | null;
  nextAttemptAt: number | null;
  inflight: number;
  healthy: boolean;
  lastError: string | null;
  lastErrorAt: number | null;
  unknownOutcomes: number;
  /** 状态库读取、写入或调度失败的累计次数；成功恢复后健康度可以重新变绿。 */
  storeErrors: number;
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
  return redactRouterError(error);
}

/** 根据事件、规则和动作组成稳定 SHA-256 投递幂等键。 */
export function stableDeliveryKey(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** 驱动持久队列出队、并发发布、重试、DLQ 和运行状态统计。 */
export class ReliableRouteDispatcher {
  private running = false;
  private drainPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | undefined;
  private counters = {
    accepted: 0,
    duplicates: 0,
    delivered: 0,
    retries: 0,
    deadLetters: 0,
    unknownOutcomes: 0,
    storeErrors: 0,
  };
  private inflight = 0;
  private lastError: string | null = null;
  private lastErrorAt: number | null = null;
  private durabilityUncertain = false;
  private lastStoreErrorLogAt = 0;
  private lastStoreDiagnostic: string | null = null;
  /** 状态库短暂不可读时仍返回最后一次低敏容量快照，而不是让健康端点自身崩溃。 */
  private lastSnapshot: RouteStoreSnapshot = {
    pending: 0,
    deliveredKeys: 0,
    deadLetters: 0,
    oldestPendingAt: null,
    nextAttemptAt: null,
  };

  constructor(
    private readonly api: OpenClawPluginApi,
    private readonly config: RouterConfig,
    private readonly store: DurableRouteStore,
    private readonly publish: PublishInboundFn | undefined,
  ) {}

  async start(): Promise<void> {
    await this.store.initialize();
    if (!this.publish) {
      // 初始化已经持有 writer lease；启动失败必须释放，否则同目录后续实例无法接管。
      await this.store.close();
      throw new Error("[router] Gateway send capability is unavailable");
    }
    this.running = true;
    this.wake();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    try {
      await this.drainPromise;
    } finally {
      // 无论后台 drain 是否异常，服务停止都必须释放 heartbeat、文件句柄和 writer lease。
      await this.store.close();
    }
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
    let snapshot = this.lastSnapshot;
    let storeAvailable = true;
    try {
      snapshot = await this.store.snapshot();
      this.lastSnapshot = snapshot;
    } catch (error) {
      storeAvailable = false;
      this.recordStoreFailure(error, "status snapshot");
    }
    if (!this.durabilityUncertain && snapshot.pending === 0 && snapshot.deadLetters === 0 && this.inflight === 0) {
      if (storeAvailable) {
        this.lastError = null;
        this.lastErrorAt = null;
      }
    }
    const healthy = this.running && storeAvailable && snapshot.deadLetters === 0 && this.lastError === null && !this.durabilityUncertain;
    return {
      running: this.running,
      ...this.counters,
      deadLetters: snapshot.deadLetters,
      pending: snapshot.pending,
      deliveredKeys: snapshot.deliveredKeys,
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
    // 把后台异常收敛为状态并继续调度，避免 rejected Promise 让 stop() 跳过 store.close()。
    this.drainPromise = this.runDrain()
      .catch((error: unknown) => {
        this.recordStoreFailure(error, "background delivery drain");
      })
      .finally(() => {
        this.drainPromise = null;
        if (this.running) this.scheduleNextSafely();
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
      // 同一份脱敏文本同时进入状态、持久 DLQ/审计和日志，避免不同出口遗漏凭据。
      const diagnostic = errorMessage(error);
      this.lastError = diagnostic;
      this.lastErrorAt = Date.now();
      if (error instanceof Error && error.name === "RouterDeliveryTimeoutError") this.counters.unknownOutcomes += 1;
      const attempts = task.attempts + 1;
      const dead = attempts >= this.config.delivery.maxAttempts;
      const nextAttemptAt = dead ? null : Date.now() + this.retryDelay(attempts);
      const outcome = await this.store.markFailed(task, diagnostic, nextAttemptAt);
      if (outcome === "dead-letter") {
        this.counters.deadLetters += 1;
        this.api.logger.error(`[router] delivery exhausted task=${task.id} rule=${task.ruleId}: ${diagnostic}`);
      } else {
        this.counters.retries += 1;
        this.api.logger.warn(`[router] delivery ${outcome === "blocked" ? "blocked by full DLQ" : `retry ${attempts}/${this.config.delivery.maxAttempts}`} task=${task.id}: ${diagnostic}`);
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

  /**
   * 调度快照失败时设置一个有界恢复定时器。没有这个兜底，瞬时磁盘错误后即使状态库恢复，
   * pending 任务也要等到下一条新消息入队才会再次被唤醒。
   */
  private scheduleNextSafely(): void {
    void this.scheduleNext().catch((error: unknown) => {
      this.recordStoreFailure(error, "retry scheduling");
      if (!this.running || this.retryTimer) return;
      this.retryTimer = setTimeout(() => {
        this.retryTimer = undefined;
        this.wake();
      }, Math.max(100, this.config.delivery.initialDelayMs));
      this.retryTimer.unref();
    });
  }

  /** 统一记录状态库故障；错误先脱敏，再进入状态与日志。 */
  private recordStoreFailure(error: unknown, phase: string): void {
    const diagnostic = errorMessage(error);
    const now = Date.now();
    this.counters.storeErrors += 1;
    this.lastError = diagnostic;
    this.lastErrorAt = now;
    // 健康探针可能高频调用；相同磁盘故障最多每 30 秒写一次日志，避免故障期间日志风暴。
    if (
      diagnostic !== this.lastStoreDiagnostic ||
      now - this.lastStoreErrorLogAt >= 30_000
    ) {
      this.api.logger.error(`[router] ${phase} failed: ${diagnostic}`);
      this.lastStoreDiagnostic = diagnostic;
      this.lastStoreErrorLogAt = now;
    }
  }
}

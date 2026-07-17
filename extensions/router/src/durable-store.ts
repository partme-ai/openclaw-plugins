/**
 * @fileoverview Router 待投递、去重键、死信和审计记录的单写者持久化存储。
 *
 * 状态变更在内存副本上完成，经临时文件写入、文件 fsync、原子 rename 和目录 fsync 后才
 * 提交；进程/主机 lease 与心跳阻止多个 Gateway 同时写同一目录。存储同时执行载荷大小、
 * pending/DLQ 容量和去重 TTL 约束，并能识别“rename 已提交但目录持久性不确定”的结果。
 */
import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import { redactRouterError } from "./redact.js";
import type { RouteDeliveryTask, RouterConfig } from "./types.js";

/** 已持久化投递状态变更的脱敏审计记录，不保存消息正文。 */
export type RouteAuditEntry = {
  taskId: string;
  ruleId: string;
  actionType: RouteDeliveryTask["actionType"];
  outcome: "delivered" | "retry" | "dead-letter" | "replayed";
  attempts: number;
  at: number;
  error?: string;
};

type RouterState = {
  version: 1;
  pending: Record<string, RouteDeliveryTask>;
  delivered: Record<string, number>;
  deadLetters: RouteDeliveryTask[];
  audit: RouteAuditEntry[];
};

type LeaseOwner = {
  token: string;
  pid: number;
  hostname: string;
  startedAt: number;
  heartbeatAt: number;
};

/**
 * 状态文件 rename 已提交、但目录 fsync 失败时的特殊错误。
 *
 * 调用方不得把任务重新入队，否则可能重复投递；应保留 delivered 状态并把健康度降级为
 * “持久性不确定”，等待运维检查存储设备。
 */
export class CommittedPersistenceError extends Error {
  constructor(cause: unknown) {
    super(`[router] state rename committed but directory fsync failed: ${redactRouterError(cause)}`);
    this.name = "CommittedPersistenceError";
  }
}

/** 运维状态接口使用的持久队列容量与时间摘要。 */
export type RouteStoreSnapshot = {
  pending: number;
  deliveredKeys: number;
  deadLetters: number;
  oldestPendingAt: number | null;
  nextAttemptAt: number | null;
};

/** 原子批量入队结果；fan-out 要么整体持久提交，要么不启动任何投递。 */
export type EnqueueBatchResult = { enqueued: number; duplicates: number };

const EMPTY_STATE = (): RouterState => ({ version: 1, pending: {}, delivered: {}, deadLetters: [], audit: [] });

function cloneState(state: RouterState): RouterState {
  return structuredClone(state);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertTask(value: unknown, location: string): asserts value is RouteDeliveryTask {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.dedupeKey !== "string" ||
    typeof value.ruleId !== "string" || (value.actionType !== "forward" && value.actionType !== "reply-via") ||
    !isRecord(value.payload) || typeof value.payload.channel !== "string" || typeof value.payload.content !== "string" ||
    typeof value.attempts !== "number" || typeof value.createdAt !== "number" || typeof value.nextAttemptAt !== "number") {
    throw new Error(`[router] invalid delivery state at ${location}`);
  }
}

function parseState(raw: string): RouterState {
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.pending) || !isRecord(value.delivered) ||
    !Array.isArray(value.deadLetters) || !Array.isArray(value.audit)) {
    throw new Error("[router] unsupported or invalid delivery-state.json schema");
  }
  for (const [key, task] of Object.entries(value.pending)) assertTask(task, `pending.${key}`);
  for (const [key, timestamp] of Object.entries(value.delivered)) {
    if (typeof timestamp !== "number") throw new Error(`[router] invalid delivered timestamp at ${key}`);
  }
  value.deadLetters.forEach((task, index) => assertTask(task, `deadLetters.${index}`));
  return value as RouterState;
}

/** 为可靠投递器提供串行、原子、单写者的磁盘状态机。 */
export class DurableRouteStore {
  private readonly filePath: string;
  private readonly stateDir: string;
  private readonly leaseDir: string;
  private readonly leaseOwnerPath: string;
  private readonly leaseOwner: LeaseOwner;
  private state: RouterState = EMPTY_STATE();
  private initialized = false;
  private operation: Promise<unknown> = Promise.resolve();
  private heartbeatTimer: NodeJS.Timeout | undefined;
  private leaseError: Error | undefined;

  constructor(stateDir: string, private readonly config: RouterConfig) {
    this.stateDir = stateDir;
    this.filePath = join(stateDir, "delivery-state.json");
    this.leaseDir = join(stateDir, ".writer.lock");
    this.leaseOwnerPath = join(this.leaseDir, "owner.json");
    const now = Date.now();
    this.leaseOwner = { token: randomUUID(), pid: process.pid, hostname: hostname(), startedAt: now, heartbeatAt: now };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.lock(async () => {
      if (this.initialized) return;
      await mkdir(this.stateDir, { recursive: true });
      await this.acquireLease();
      try {
        try {
          this.state = parseState(await readFile(this.filePath, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const next = cloneState(this.state);
        this.prune(next, Date.now());
        this.state = next;
        this.initialized = true;
        this.startHeartbeat();
      } catch (error) {
        await this.releaseLease();
        throw error;
      }
    });
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
    await this.lock(async () => {
      if (this.initialized) await this.releaseLease();
      this.initialized = false;
    });
  }

  async enqueue(task: RouteDeliveryTask): Promise<"enqueued" | "duplicate"> {
    const result = await this.enqueueBatch([task]);
    return result.enqueued === 1 ? "enqueued" : "duplicate";
  }

  async enqueueBatch(tasks: RouteDeliveryTask[]): Promise<EnqueueBatchResult> {
    await this.initialize();
    return this.lock(async () => {
      this.assertLeaseHealthy();
      const next = cloneState(this.state);
      this.prune(next, Date.now());
      let enqueued = 0;
      let duplicates = 0;
      const acceptedIds = new Set<string>();
      for (const task of tasks) {
        const payloadBytes = Buffer.byteLength(JSON.stringify(task.payload), "utf8");
        if (payloadBytes > this.config.delivery.maxPayloadBytes) {
          throw new Error(`[router] payload ${payloadBytes} bytes exceeds maxPayloadBytes=${this.config.delivery.maxPayloadBytes}`);
        }
        const duplicate = acceptedIds.has(task.id) || next.pending[task.id] || next.delivered[task.dedupeKey] !== undefined ||
          next.deadLetters.some((item) => item.id === task.id);
        if (duplicate) {
          duplicates += 1;
          continue;
        }
        acceptedIds.add(task.id);
        next.pending[task.id] = structuredClone(task);
        enqueued += 1;
      }
      if (Object.keys(next.pending).length > this.config.delivery.maxPendingTasks) {
        throw new Error(`[router] pending capacity ${this.config.delivery.maxPendingTasks} reached`);
      }
      if (enqueued > 0) {
        await this.commitState(next);
      }
      return { enqueued, duplicates };
    });
  }

  async due(now = Date.now(), limit = 100): Promise<RouteDeliveryTask[]> {
    await this.initialize();
    return this.lock(() => {
      this.assertLeaseHealthy();
      return Object.values(this.state.pending).filter((task) => task.nextAttemptAt <= now)
        .sort((left, right) => left.nextAttemptAt - right.nextAttemptAt || left.createdAt - right.createdAt)
        .slice(0, limit).map((task) => structuredClone(task));
    });
  }

  async ownsIdentity(identity: string): Promise<boolean> {
    await this.initialize();
    return this.lock(() => Boolean(this.state.pending[identity] || this.state.delivered[identity] !== undefined ||
      this.state.deadLetters.some((task) => task.id === identity)));
  }

  async markDelivered(task: RouteDeliveryTask): Promise<void> {
    await this.mutate(async (next) => {
      delete next.pending[task.id];
      next.delivered[task.dedupeKey] = Date.now();
      this.appendAudit(next, task, "delivered");
      this.prune(next, Date.now());
    });
  }

  async markFailed(task: RouteDeliveryTask, error: string, nextAttemptAt: number | null): Promise<"retry" | "dead-letter" | "blocked"> {
    let outcome: "retry" | "dead-letter" | "blocked" = nextAttemptAt === null ? "dead-letter" : "retry";
    await this.mutate(async (next) => {
      const failed = { ...task, attempts: task.attempts + 1, lastError: error };
      if (nextAttemptAt === null) {
        if (next.deadLetters.length >= this.config.delivery.maxDeadLetters) {
          outcome = "blocked";
          const blockedError = `${error}; DLQ capacity ${this.config.delivery.maxDeadLetters} reached`;
          next.pending[task.id] = { ...failed, lastError: blockedError, nextAttemptAt: Date.now() + this.config.delivery.maxDelayMs };
          this.appendAudit(next, next.pending[task.id], "retry", blockedError);
          return;
        }
        delete next.pending[task.id];
        next.deadLetters.push(failed);
        this.appendAudit(next, failed, "dead-letter", error);
      } else {
        next.pending[task.id] = { ...failed, nextAttemptAt };
        this.appendAudit(next, failed, "retry", error);
      }
    });
    return outcome;
  }

  async replayDeadLetters(limit = 100): Promise<number> {
    await this.initialize();
    return this.lock(async () => {
      this.assertLeaseHealthy();
      const next = cloneState(this.state);
      const replay = next.deadLetters.splice(0, Math.max(0, Math.floor(limit)));
      if (Object.keys(next.pending).length + replay.length > this.config.delivery.maxPendingTasks) {
        throw new Error(`[router] replay would exceed pending capacity ${this.config.delivery.maxPendingTasks}`);
      }
      const now = Date.now();
      for (const task of replay) {
        const replayed = { ...task, attempts: 0, nextAttemptAt: now, lastError: undefined };
        next.pending[replayed.id] = replayed;
        this.appendAudit(next, replayed, "replayed");
      }
      if (replay.length > 0) {
        await this.commitState(next);
      }
      return replay.length;
    });
  }

  async snapshot(): Promise<RouteStoreSnapshot> {
    await this.initialize();
    return this.lock(() => {
      this.assertLeaseHealthy();
      const pending = Object.values(this.state.pending);
      let oldestPendingAt: number | null = null;
      let nextAttemptAt: number | null = null;
      for (const task of pending) {
        oldestPendingAt = oldestPendingAt === null ? task.createdAt : Math.min(oldestPendingAt, task.createdAt);
        nextAttemptAt = nextAttemptAt === null ? task.nextAttemptAt : Math.min(nextAttemptAt, task.nextAttemptAt);
      }
      return {
        pending: pending.length,
        deliveredKeys: Object.keys(this.state.delivered).length,
        deadLetters: this.state.deadLetters.length,
        oldestPendingAt,
        nextAttemptAt,
      };
    });
  }

  async deadLetters(limit = 100): Promise<RouteDeliveryTask[]> {
    await this.initialize();
    return this.lock(() => this.state.deadLetters.slice(-Math.max(0, Math.floor(limit))).map((task) => structuredClone(task)));
  }

  async auditEntries(limit = 100): Promise<RouteAuditEntry[]> {
    await this.initialize();
    return this.lock(() => this.state.audit.slice(-Math.max(0, Math.floor(limit))).map((entry) => ({ ...entry })));
  }

  private async mutate(change: (next: RouterState) => void | Promise<void>): Promise<void> {
    await this.initialize();
    await this.lock(async () => {
      this.assertLeaseHealthy();
      const next = cloneState(this.state);
      await change(next);
      await this.commitState(next);
    });
  }

  private async commitState(next: RouterState): Promise<void> {
    try {
      await this.persist(next);
      this.state = next;
    } catch (error) {
      if (error instanceof CommittedPersistenceError) this.state = next;
      throw error;
    }
  }

  private appendAudit(state: RouterState, task: RouteDeliveryTask, outcome: RouteAuditEntry["outcome"], error?: string): void {
    if (!this.config.audit.enabled) return;
    state.audit.push({ taskId: task.id, ruleId: task.ruleId, actionType: task.actionType, outcome, attempts: task.attempts, at: Date.now(), ...(error ? { error } : {}) });
    if (state.audit.length > this.config.audit.maxEntries) state.audit.splice(0, state.audit.length - this.config.audit.maxEntries);
  }

  private prune(state: RouterState, now: number): void {
    const cutoff = now - this.config.delivery.dedupeTtlMs;
    for (const [key, deliveredAt] of Object.entries(state.delivered)) if (deliveredAt <= cutoff) delete state.delivered[key];
    const delivered = Object.entries(state.delivered).sort((left, right) => left[1] - right[1]);
    for (const [key] of delivered.slice(0, Math.max(0, delivered.length - this.config.delivery.maxDeliveredKeys))) delete state.delivered[key];
  }

  private async persist(state: RouterState): Promise<void> {
    await this.assertLeaseOwnership();
    const temporary = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.filePath);
      try {
        const directory = await open(dirname(this.filePath), "r");
        try { await directory.sync(); } finally { await directory.close(); }
      } catch (error) {
        throw error instanceof CommittedPersistenceError ? error : new CommittedPersistenceError(error);
      }
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private async acquireLease(): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await mkdir(this.leaseDir);
        await this.writeLeaseOwner();
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      if (!await this.isLeaseStale()) {
        throw new Error(`[router] state directory already has an active writer: ${this.stateDir}`);
      }
      const stalePath = `${this.leaseDir}.stale-${randomUUID()}`;
      try {
        await rename(this.leaseDir, stalePath);
        await rm(stalePath, { recursive: true, force: true });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "EEXIST") throw error;
      }
    }
    throw new Error(`[router] failed to acquire state writer lease: ${this.stateDir}`);
  }

  private async isLeaseStale(): Promise<boolean> {
    try {
      const owner = JSON.parse(await readFile(this.leaseOwnerPath, "utf8")) as Partial<LeaseOwner>;
      if (owner.hostname === hostname() && typeof owner.pid === "number") {
        try { process.kill(owner.pid, 0); return false; } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
          if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
        }
      }
      const heartbeatAt = typeof owner.heartbeatAt === "number" ? owner.heartbeatAt : (await stat(this.leaseOwnerPath)).mtimeMs;
      return Date.now() - heartbeatAt > this.config.delivery.lockTimeoutMs;
    } catch {
      try {
        const lockDirectory = await stat(this.leaseDir);
        return Date.now() - lockDirectory.mtimeMs > this.config.delivery.lockTimeoutMs;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT";
      }
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      void this.renewLease().catch((error: unknown) => {
        this.leaseError = new Error(`[router] writer lease heartbeat failed: ${redactRouterError(error)}`);
      });
    }, this.config.delivery.lockHeartbeatMs);
    this.heartbeatTimer.unref();
  }

  private async renewLease(): Promise<void> {
    await this.assertLeaseOwnership();
    this.leaseOwner.heartbeatAt = Date.now();
    await this.writeLeaseOwner();
  }

  private async writeLeaseOwner(): Promise<void> {
    await writeFile(this.leaseOwnerPath, `${JSON.stringify(this.leaseOwner)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  private async releaseLease(): Promise<void> {
    try {
      const owner = JSON.parse(await readFile(this.leaseOwnerPath, "utf8")) as Partial<LeaseOwner>;
      if (owner.token === this.leaseOwner.token) await rm(this.leaseDir, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private assertLeaseHealthy(): void {
    if (this.leaseError) throw this.leaseError;
  }

  private async assertLeaseOwnership(): Promise<void> {
    this.assertLeaseHealthy();
    const owner = JSON.parse(await readFile(this.leaseOwnerPath, "utf8")) as Partial<LeaseOwner>;
    if (owner.token !== this.leaseOwner.token) {
      this.leaseError = new Error("[router] writer lease was lost; refusing further state writes");
      throw this.leaseError;
    }
  }

  private lock<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(() => undefined, () => undefined);
    return next;
  }
}

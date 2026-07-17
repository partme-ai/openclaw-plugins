/**
 * @fileoverview 抖音 Webhook 的账号级持久 Inbox 与后台重试调度器。
 *
 * 平台回调要求快速确认，不能等待一次可能持续数十秒的 Agent Turn；但仅把 Promise 丢到后台，
 * Gateway 在派发完成前崩溃就会永久丢消息。本模块把已验签事件先以 0600 权限原子写入 stateDir，
 * 持久提交成功后 HTTP 层才返回 200；后台消费失败按指数退避重试，耗尽后进入有界 DLQ。
 */
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveOpenClawStateDir } from "@partme.ai/openclaw-message-sdk/openclaw";
import type { DouyinWebhookDispatchResult } from "./dispatch-inbound.js";

export type DouyinWebhookInboxItem = {
  messageId: string;
  rawBody: string;
  text: string;
  peerId: string;
  attempts: number;
  createdAt: number;
  nextAttemptAt: number;
  lastError?: string;
};

type InboxState = {
  version: 1;
  pending: Record<string, DouyinWebhookInboxItem>;
  deadLetters: DouyinWebhookInboxItem[];
};

export type DouyinWebhookInboxConfig = {
  maxPending: number;
  maxAttempts: number;
  initialDelayMs: number;
  maxDelayMs: number;
  maxDeadLetters: number;
  maxStateBytes: number;
};

export type DouyinWebhookInboxStatus = {
  running: boolean;
  pending: number;
  deadLetters: number;
  oldestPendingAt: number | null;
  lastError: string | null;
};

type InboxLogger = {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
};

const EMPTY_STATE = (): InboxState => ({
  version: 1,
  pending: {},
  deadLetters: [],
});
/** 同一进程内禁止热重载的新旧生命周期同时写同一个账号文件。 */
const claimedInboxFiles = new Set<string>();
const TERMINAL_RESULTS = new Set<DouyinWebhookDispatchResult>([
  "dispatched",
  "duplicate",
  "blocked",
]);

function safeAccountSegment(accountId: string): string {
  const readable =
    accountId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "default";
  const suffix = createHash("sha256")
    .update(accountId)
    .digest("hex")
    .slice(0, 12);
  return `${readable}-${suffix}`;
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/[\r\n\t\u0000-\u001f\u007f]+/gu, " ").slice(0, 500);
}

function parseState(raw: string): InboxState {
  const value = JSON.parse(raw) as Partial<InboxState>;
  if (
    value.version !== 1 ||
    !value.pending ||
    typeof value.pending !== "object" ||
    !Array.isArray(value.deadLetters)
  ) {
    throw new Error("[douyin] invalid webhook inbox state");
  }
  for (const [key, item] of Object.entries(value.pending)) {
    assertInboxItem(item, `pending.${key}`);
  }
  value.deadLetters.forEach((item, index) =>
    assertInboxItem(item, `deadLetters.${index}`),
  );
  return value as InboxState;
}

function assertInboxItem(
  value: unknown,
  location: string,
): asserts value is DouyinWebhookInboxItem {
  const item = value as Partial<DouyinWebhookInboxItem> | null;
  if (
    !item ||
    typeof item !== "object" ||
    typeof item.messageId !== "string" ||
    typeof item.rawBody !== "string" ||
    typeof item.text !== "string" ||
    typeof item.peerId !== "string" ||
    !Number.isSafeInteger(item.attempts) ||
    typeof item.createdAt !== "number" ||
    !Number.isFinite(item.createdAt) ||
    typeof item.nextAttemptAt !== "number" ||
    !Number.isFinite(item.nextAttemptAt)
  ) {
    throw new Error(`[douyin] invalid webhook inbox item at ${location}`);
  }
}

/** 单账号、单写者的持久 Webhook Inbox。 */
export class DouyinWebhookInbox {
  private readonly filePath: string;
  private state = EMPTY_STATE();
  private operation: Promise<unknown> = Promise.resolve();
  private running = false;
  private drainPromise: Promise<void> | null = null;
  private retryTimer: NodeJS.Timeout | undefined;
  private lastError: string | null = null;

  constructor(
    accountId: string,
    private readonly config: DouyinWebhookInboxConfig,
    private readonly dispatch: (
      item: DouyinWebhookInboxItem,
    ) => Promise<DouyinWebhookDispatchResult>,
    private readonly logger: InboxLogger = {},
    stateDir = join(resolveOpenClawStateDir(), "douyin", "inbox"),
  ) {
    this.filePath = join(stateDir, `${safeAccountSegment(accountId)}.json`);
  }

  /** 加载未完成事件并启动后台恢复。损坏状态必须失败关闭，不能覆盖后假装队列为空。 */
  async start(): Promise<void> {
    if (claimedInboxFiles.has(this.filePath)) {
      throw new Error(
        `[douyin] webhook inbox already has an active writer: ${this.filePath}`,
      );
    }
    claimedInboxFiles.add(this.filePath);
    try {
      await this.lock(async () => {
        try {
          const fileStat = await stat(this.filePath);
          if (fileStat.size > this.config.maxStateBytes) {
            throw new Error(
              `[douyin] webhook inbox state exceeds maxStateBytes=${this.config.maxStateBytes}`,
            );
          }
          this.state = parseState(await readFile(this.filePath, "utf8"));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
        }
        this.running = true;
      });
    } catch (error) {
      claimedInboxFiles.delete(this.filePath);
      throw error;
    }
    this.wake();
  }

  /** 停止接收新任务，取消重试定时器，并等待当前持久状态变更完成。 */
  async stop(): Promise<void> {
    this.running = false;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = undefined;
    try {
      await this.drainPromise;
      await this.operation;
    } finally {
      claimedInboxFiles.delete(this.filePath);
    }
  }

  /**
   * 在 HTTP ACK 前原子持久化事件。相同 Msg-Id 已在 pending/DLQ 时返回 duplicate；队列满或
   * 磁盘失败则抛错，让 HTTP 层返回 503，绝不能确认一条尚未接管的数据。
   */
  async enqueue(
    item: Omit<
      DouyinWebhookInboxItem,
      "attempts" | "createdAt" | "nextAttemptAt"
    >,
  ): Promise<"enqueued" | "duplicate"> {
    const result = await this.lock(async () => {
      if (!this.running) {
        throw new Error("[douyin] webhook inbox is not running");
      }
      if (
        this.state.pending[item.messageId] ||
        this.state.deadLetters.some(
          (entry) => entry.messageId === item.messageId,
        )
      ) {
        return "duplicate" as const;
      }
      if (Object.keys(this.state.pending).length >= this.config.maxPending) {
        throw new Error(
          `[douyin] webhook inbox capacity ${this.config.maxPending} reached`,
        );
      }
      const now = Date.now();
      const next = structuredClone(this.state);
      next.pending[item.messageId] = {
        ...item,
        attempts: 0,
        createdAt: now,
        nextAttemptAt: now,
      };
      await this.persist(next);
      this.state = next;
      return "enqueued" as const;
    });
    if (result === "enqueued") {
      this.wake();
    }
    return result;
  }

  /** 返回不包含消息正文、用户 ID 或凭据的运维摘要。 */
  status(): DouyinWebhookInboxStatus {
    const pending = Object.values(this.state.pending);
    return {
      running: this.running,
      pending: pending.length,
      deadLetters: this.state.deadLetters.length,
      oldestPendingAt: pending.length
        ? Math.min(...pending.map((item) => item.createdAt))
        : null,
      lastError: this.lastError,
    };
  }

  /** 管理员显式重放最近的死信；先受 pending 容量约束并原子落盘，再唤醒消费者。 */
  async replayDeadLetters(limit = 100): Promise<number> {
    const replayed = await this.lock(async () => {
      const count = Math.min(
        Math.max(0, Math.floor(limit)),
        this.state.deadLetters.length,
        Math.max(
          0,
          this.config.maxPending - Object.keys(this.state.pending).length,
        ),
      );
      if (count === 0) {
        return 0;
      }
      const next = structuredClone(this.state);
      const tasks = next.deadLetters.splice(0, count);
      const now = Date.now();
      for (const task of tasks) {
        next.pending[task.messageId] = {
          ...task,
          attempts: 0,
          nextAttemptAt: now,
          lastError: undefined,
        };
      }
      await this.persist(next);
      this.state = next;
      return count;
    });
    if (replayed > 0) {
      this.wake();
    }
    return replayed;
  }

  private wake(): void {
    if (!this.running || this.drainPromise) {
      return;
    }
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (this.running) {
        void this.scheduleNext();
      }
    });
    void this.drainPromise.catch((error: unknown) => {
      this.lastError = errorMessage(error);
      this.logger.error?.(
        `[douyin] webhook inbox drain failed: ${this.lastError}`,
      );
    });
  }

  private async drain(): Promise<void> {
    while (this.running) {
      const item = await this.lock(
        () =>
          Object.values(this.state.pending)
            .filter((entry) => entry.nextAttemptAt <= Date.now())
            .sort(
              (left, right) =>
                left.nextAttemptAt - right.nextAttemptAt ||
                left.createdAt - right.createdAt,
            )[0],
      );
      if (!item) {
        return;
      }
      await this.process(item);
    }
  }

  private async process(item: DouyinWebhookInboxItem): Promise<void> {
    try {
      const result = await this.dispatch(structuredClone(item));
      if (TERMINAL_RESULTS.has(result)) {
        await this.remove(item.messageId);
        this.lastError = null;
        return;
      }
      await this.fail(item, `dispatch result: ${result}`);
    } catch (error) {
      await this.fail(item, errorMessage(error));
    }
  }

  private async remove(messageId: string): Promise<void> {
    await this.lock(async () => {
      const next = structuredClone(this.state);
      delete next.pending[messageId];
      await this.persist(next);
      this.state = next;
    });
  }

  private async fail(
    item: DouyinWebhookInboxItem,
    diagnostic: string,
  ): Promise<void> {
    this.lastError = diagnostic;
    await this.lock(async () => {
      const current = this.state.pending[item.messageId];
      if (!current) {
        return;
      }
      const attempts = current.attempts + 1;
      const next = structuredClone(this.state);
      const failed = { ...current, attempts, lastError: diagnostic };
      if (attempts >= this.config.maxAttempts) {
        if (next.deadLetters.length >= this.config.maxDeadLetters) {
          next.pending[item.messageId] = {
            ...failed,
            nextAttemptAt: Date.now() + this.config.maxDelayMs,
            lastError: `${diagnostic}; DLQ capacity reached`,
          };
        } else {
          delete next.pending[item.messageId];
          next.deadLetters.push(failed);
          this.logger.error?.(
            `[douyin] webhook moved to DLQ after ${attempts} attempts`,
          );
        }
      } else {
        const delay = Math.min(
          this.config.maxDelayMs,
          this.config.initialDelayMs * 2 ** Math.max(0, attempts - 1),
        );
        next.pending[item.messageId] = {
          ...current,
          attempts,
          lastError: diagnostic,
          nextAttemptAt: Date.now() + delay,
        };
        this.logger.warn?.(
          `[douyin] webhook retry ${attempts}/${this.config.maxAttempts}`,
        );
      }
      await this.persist(next);
      this.state = next;
    });
  }

  private async scheduleNext(): Promise<void> {
    if (!this.running) {
      return;
    }
    const nextAttemptAt = await this.lock(() => {
      const values = Object.values(this.state.pending);
      return values.length
        ? Math.min(...values.map((item) => item.nextAttemptAt))
        : null;
    });
    if (nextAttemptAt === null) {
      return;
    }
    const delay = Math.max(10, nextAttemptAt - Date.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.wake();
    }, delay);
    this.retryTimer.unref();
  }

  /** 临时文件写入、文件 fsync、原子 rename、目录 fsync，确保 200 前已完成持久提交。 */
  private async persist(state: InboxState): Promise<void> {
    const payload = `${JSON.stringify(state)}\n`;
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (payloadBytes > this.config.maxStateBytes) {
      throw new Error(
        `[douyin] webhook inbox state ${payloadBytes} bytes exceeds maxStateBytes=${this.config.maxStateBytes}`,
      );
    }
    await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 });
    await chmod(dirname(this.filePath), 0o700);
    const temporary = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.filePath);
      const directory = await open(dirname(this.filePath), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private lock<T>(operation: () => T | Promise<T>): Promise<T> {
    const next = this.operation.then(operation, operation);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

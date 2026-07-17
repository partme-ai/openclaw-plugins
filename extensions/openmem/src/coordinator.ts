/**
 * OpenClaw 会话与 OpenMem session 的协调器。
 *
 * 它维护 sessionKey 到 ACTIVE session 的进程内映射，并用稳定 eventId 幂等追加当前轮；
 * session_end 负责提交归档。内容只截取最后一个 user 开始的当前轮，避免重复上传历史。
 */
import { createHash, randomUUID } from "node:crypto";

import { OpenMemClient } from "./client.js";

const MAX_ACTIVE_SESSIONS = 10_000;
const RECOVERY_EVENT_LIMIT = 1_000;

type RecoverableEvent = {
  content?: unknown;
  payload?: {
    role?: unknown;
    openclawAgentId?: unknown;
    openclawTurnId?: unknown;
    openclawTurnIndex?: unknown;
    openclawTurnSize?: unknown;
  };
};

type SessionDetails = OpenMemSession & { metadata?: { append_notes?: unknown } };

/** OpenMem 会话列表与创建接口返回的最小字段集合。 */
export type OpenMemSession = {
  session_id: string;
  agent_id?: string;
  thread_id?: string;
  status: "ACTIVE" | "CLOSING" | "ARCHIVED" | "FAILED";
  updated_at: string;
};

/** 从 OpenClaw 消息历史中提取出的单条当前轮文本。 */
export type TurnMessage = { role: string; content: string };

function contentText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (!part || typeof part !== "object") return "";
    const item = part as { type?: unknown; text?: unknown };
    return item.type === "text" && typeof item.text === "string" ? item.text : "";
  }).filter(Boolean).join("\n").trim();
}

/**
 * 把 OpenClaw 文本/内容块消息规整成可摄取的当前轮。
 *
 * 只保留最后一条 user 消息及其后的回复，避免 `agent_end` 携带完整历史时重复写入旧轮次；
 * 单条文本限制为 16,000 字符，降低异常工具输出对 Sidecar 的冲击。
 */
export function normalizeTurn(messages: unknown[]): TurnMessage[] {
  const normalized = messages.flatMap((message): TurnMessage[] => {
    if (!message || typeof message !== "object") return [];
    const item = message as { role?: unknown; content?: unknown };
    if (typeof item.role !== "string") return [];
    const content = contentText(item.content);
    return content ? [{ role: item.role, content: content.slice(0, 16_000) }] : [];
  });
  let lastUser = -1;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index]?.role === "user") {
      lastUser = index;
      break;
    }
  }
  return lastUser >= 0 ? normalized.slice(lastUser) : normalized.slice(-1);
}

/**
 * 协调 OpenClaw sessionKey 与 OpenMem ACTIVE/ARCHIVED session 的生命周期。
 *
 * ACTIVE 映射仅用于进程内加速，Sidecar 会话列表始终是重启后的事实来源；映射设有数量上限，
 * 防止长期没有触发 `session_end` 的会话持续占用 Gateway 内存。
 */
export class OpenMemCoordinator {
  private readonly active = new Map<string, string>();
  private readonly sessionOperations = new Map<string, Promise<void>>();

  constructor(private readonly client: OpenMemClient, private readonly agentId: string) {}

  /** 等待所有已进入会话串行队列的操作收敛；客户端关闭后在途网络与退避会被立即取消。 */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.sessionOperations.values()]);
  }

  async startSession(sessionKey: string, channel?: string): Promise<string> {
    return this.withSessionLock(sessionKey, () => this.ensureActive(sessionKey, channel));
  }

  async ingestTurn(params: {
    sessionKey: string;
    messages: TurnMessage[];
    runId?: string;
    channel?: string;
  }): Promise<void> {
    await this.withSessionLock(params.sessionKey, async () => {
      const sessionId = await this.ensureActive(params.sessionKey, params.channel);
      const seed = params.runId ?? randomUUID();
      const turnId = createHash("sha256").update(`${this.agentId}\u0000${seed}`).digest("hex");
      const events = params.messages.map((message, index) => ({
        eventId: createHash("sha256").update(`${turnId}\u0000${index}`).digest("hex"),
        sessionId,
        type: "agent_message",
        source: "runtime",
        content: message.content,
        payload: {
          role: message.role,
          openclawAgentId: this.agentId,
          openclawTurnId: turnId,
          openclawTurnIndex: index,
          openclawTurnSize: params.messages.length,
        },
      }));
      // 事件日志是恢复事实源：先以确定性 eventId 落盘，再把同一轮投影到 working memory。
      await this.client.post("/events/ingest", { events }, { retrySafe: true });
      await this.appendTurnIfMissing(sessionId, turnId, params.messages);
    });
  }

  async endSession(sessionKey: string): Promise<void> {
    await this.withSessionLock(sessionKey, async () => {
      const scoped = this.scopeKey(sessionKey);
      const cached = this.active.get(scoped);
      const sessionId = cached ?? (await this.findSession(sessionKey, "ACTIVE"))?.session_id;
      if (!sessionId) return;
      // commit 会归档并拒绝后续 append，所以必须先补齐上次崩溃留下的事件投影。
      await this.recoverPendingTurns(sessionId);
      await this.client.post(`/sessions/${encodeURIComponent(sessionId)}/commit`, {});
      this.active.delete(scoped);
    });
  }

  async recallSessionId(sessionKey: string): Promise<string | undefined> {
    // OpenMem continuity 会按 sessionId 查找该 session 已生成的 archive，因此必须优先上一条
    // ARCHIVED 会话；当前 ACTIVE session 通常尚无 archive，优先它反而会得到空召回。
    const archived = await this.findSession(sessionKey, "ARCHIVED");
    if (archived) return archived.session_id;
    const scoped = this.scopeKey(sessionKey);
    const cached = this.active.get(scoped);
    if (cached) return cached;
    const active = await this.findSession(sessionKey, "ACTIVE");
    if (active) {
      this.rememberActive(scoped, active.session_id);
      return active.session_id;
    }
    return undefined;
  }

  private async ensureActive(sessionKey: string, channel?: string): Promise<string> {
    const scoped = this.scopeKey(sessionKey);
    const cached = this.active.get(scoped);
    if (cached) return cached;
    const existing = await this.findSession(sessionKey, "ACTIVE");
    if (existing) {
      this.rememberActive(scoped, existing.session_id);
      await this.recoverPendingTurns(existing.session_id);
      return existing.session_id;
    }
    const created = await this.client.post<OpenMemSession>("/sessions/start", {
      agentId: this.agentId,
      threadId: this.threadId(sessionKey),
      title: `OpenClaw ${this.agentId} session`,
      ...(channel ? { channel } : {}),
      metadata: { source: "openclaw" },
    });
    if (!created || typeof created.session_id !== "string") throw new Error("OpenMem returned an invalid session start response");
    this.rememberActive(scoped, created.session_id);
    return created.session_id;
  }

  private async findSession(sessionKey: string, status: OpenMemSession["status"]): Promise<OpenMemSession | undefined> {
    const data = await this.client.get<{ sessions?: unknown }>(`/sessions?status=${status}`);
    if (!Array.isArray(data?.sessions)) throw new Error("OpenMem returned an invalid sessions response");
    const threadId = this.threadId(sessionKey);
    return data.sessions
      .filter((value): value is OpenMemSession => Boolean(
        value && typeof value === "object" &&
        typeof (value as OpenMemSession).session_id === "string" &&
        typeof (value as OpenMemSession).updated_at === "string" &&
        (value as OpenMemSession).status === status,
      ))
      .filter((session) => session.agent_id === this.agentId && session.thread_id === threadId)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0];
  }

  private scopeKey(sessionKey: string): string {
    return `${this.agentId}\u0000${sessionKey}`;
  }

  private threadId(sessionKey: string): string {
    return `openclaw:${createHash("sha256").update(this.scopeKey(sessionKey)).digest("hex")}`;
  }

  /**
   * 把事件日志中完整、但尚未投影到 working memory 的轮次补写回来。
   *
   * OpenMem 的 append 接口没有幂等键，因此不能在网络错误后盲目重试。插件把 turnId 标记
   * 放在 append 内容开头，并通过 session.metadata.append_notes 判断是否已经成功；进程若在
   * ingest 与 append 之间退出，下次恢复 ACTIVE session 或 commit 前可由持久事件重建该轮。
   */
  private async recoverPendingTurns(sessionId: string): Promise<void> {
    const data = await this.client.get<{ events?: unknown }>(
      `/events?sessionId=${encodeURIComponent(sessionId)}&limit=${RECOVERY_EVENT_LIMIT}`,
    );
    if (!Array.isArray(data?.events)) throw new Error("OpenMem returned an invalid events response");
    const grouped = new Map<string, { size: number; messages: Map<number, TurnMessage> }>();
    for (const event of data.events) {
      if (!event || typeof event !== "object") continue;
      const item = event as RecoverableEvent;
      const payload = item.payload;
      if (!payload || payload.openclawAgentId !== this.agentId || typeof payload.openclawTurnId !== "string") continue;
      if (!Number.isSafeInteger(payload.openclawTurnIndex) || !Number.isSafeInteger(payload.openclawTurnSize)) continue;
      if (typeof item.content !== "string" || typeof payload.role !== "string") continue;
      const index = payload.openclawTurnIndex as number;
      const size = payload.openclawTurnSize as number;
      if (index < 0 || size < 1 || size > 100 || index >= size) continue;
      const group = grouped.get(payload.openclawTurnId) ?? { size, messages: new Map<number, TurnMessage>() };
      if (group.size !== size) continue;
      group.messages.set(index, { role: payload.role, content: item.content });
      grouped.set(payload.openclawTurnId, group);
    }
    for (const [turnId, group] of grouped) {
      if (group.messages.size !== group.size) continue;
      const messages = Array.from({ length: group.size }, (_, index) => group.messages.get(index));
      if (messages.some((message) => message === undefined)) continue;
      await this.appendTurnIfMissing(sessionId, turnId, messages as TurnMessage[]);
    }
  }

  /** 通过持久 turnId 标记把非幂等 append 收敛成“检查后写入”。 */
  private async appendTurnIfMissing(sessionId: string, turnId: string, messages: TurnMessage[]): Promise<void> {
    const marker = `[openclaw-turn:${turnId}]`;
    const session = await this.client.get<SessionDetails>(`/sessions/${encodeURIComponent(sessionId)}`);
    const notes = session?.metadata?.append_notes;
    if (Array.isArray(notes) && notes.some((note) => typeof note === "string" && note.startsWith(marker))) return;
    const summary = messages.map((message) => `${message.role}: ${message.content}`).join("\n");
    await this.client.post(`/sessions/${encodeURIComponent(sessionId)}/append`, {
      content: `${marker}\n${summary}`.slice(0, 8_000),
    });
  }

  /**
   * 同一 sessionKey 的 start/ingest/commit 串行执行，避免 agent_end 与 session_end 交叉，
   * 造成先归档后追加或并发创建两个 ACTIVE session；不同会话仍可并行。
   */
  private async withSessionLock<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    const scoped = this.scopeKey(sessionKey);
    const previous = this.sessionOperations.get(scoped) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.catch(() => undefined).then(() => current);
    this.sessionOperations.set(scoped, queued);
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.sessionOperations.get(scoped) === queued) this.sessionOperations.delete(scoped);
    }
  }

  /** 记录最近活跃会话，并按插入顺序淘汰最旧映射。 */
  private rememberActive(scoped: string, sessionId: string): void {
    this.active.delete(scoped);
    this.active.set(scoped, sessionId);
    while (this.active.size > MAX_ACTIVE_SESSIONS) {
      const oldest = this.active.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.active.delete(oldest);
    }
  }
}

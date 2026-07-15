import { createHash, randomUUID } from "node:crypto";

import { OpenMemClient } from "./client.js";

export type OpenMemSession = {
  session_id: string;
  agent_id?: string;
  thread_id?: string;
  status: "ACTIVE" | "CLOSING" | "ARCHIVED" | "FAILED";
  updated_at: string;
};

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

export class OpenMemCoordinator {
  private readonly active = new Map<string, string>();

  constructor(private readonly client: OpenMemClient, private readonly agentId: string) {}

  async startSession(sessionKey: string, channel?: string): Promise<string> {
    return this.ensureActive(sessionKey, channel);
  }

  async ingestTurn(params: {
    sessionKey: string;
    messages: TurnMessage[];
    runId?: string;
    channel?: string;
  }): Promise<void> {
    const sessionId = await this.ensureActive(params.sessionKey, params.channel);
    const seed = params.runId ?? randomUUID();
    const events = params.messages.map((message, index) => ({
      eventId: createHash("sha256").update(`${this.agentId}\u0000${seed}\u0000${index}`).digest("hex"),
      sessionId,
      type: "agent_message",
      source: "runtime",
      content: message.content,
      payload: { role: message.role, openclawAgentId: this.agentId },
    }));
    await this.client.post("/events/ingest", { events }, { retrySafe: true });
    const summary = params.messages.map((message) => `${message.role}: ${message.content}`).join("\n").slice(0, 8_000);
    await this.client.post(`/sessions/${encodeURIComponent(sessionId)}/append`, { content: summary });
  }

  async endSession(sessionKey: string): Promise<void> {
    const scoped = this.scopeKey(sessionKey);
    const cached = this.active.get(scoped);
    const sessionId = cached ?? (await this.findSession(sessionKey, "ACTIVE"))?.session_id;
    if (!sessionId) return;
    await this.client.post(`/sessions/${encodeURIComponent(sessionId)}/commit`, {});
    this.active.delete(scoped);
  }

  async recallSessionId(sessionKey: string): Promise<string | undefined> {
    const archived = await this.findSession(sessionKey, "ARCHIVED");
    return archived?.session_id;
  }

  private async ensureActive(sessionKey: string, channel?: string): Promise<string> {
    const scoped = this.scopeKey(sessionKey);
    const cached = this.active.get(scoped);
    if (cached) return cached;
    const existing = await this.findSession(sessionKey, "ACTIVE");
    if (existing) {
      this.active.set(scoped, existing.session_id);
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
    this.active.set(scoped, created.session_id);
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
}

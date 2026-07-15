import { randomBytes } from "node:crypto";

import type { MemoryRecord, NormalizedMessage } from "./model.js";
import { extractKeywords, normalizeMessageContent } from "./text.js";

export function generateId(): string {
  return `${Date.now()}_${randomBytes(6).toString("hex")}`;
}

export function normalizeTurnMessages(messages: unknown[]): NormalizedMessage[] {
  const normalized = messages.flatMap((message): NormalizedMessage[] => {
    if (!message || typeof message !== "object") return [];
    const candidate = message as { role?: unknown; content?: unknown };
    if (typeof candidate.role !== "string") return [];
    const content = normalizeMessageContent(candidate.content);
    return content ? [{ role: candidate.role, content }] : [];
  });
  let lastUserIndex = -1;
  for (let index = normalized.length - 1; index >= 0; index -= 1) {
    if (normalized[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return lastUserIndex >= 0 ? normalized.slice(lastUserIndex) : normalized.slice(-1);
}

export const sessionCounters = new Map<string, number>();

export function shouldExtract(sessionKey: string, everyN = 5): boolean {
  const interval = Math.max(1, Math.floor(everyN));
  if (!sessionCounters.has(sessionKey) && sessionCounters.size >= 10_000) {
    const oldest = sessionCounters.keys().next().value;
    if (typeof oldest === "string") sessionCounters.delete(oldest);
  }
  const count = (sessionCounters.get(sessionKey) ?? 0) + 1;
  sessionCounters.set(sessionKey, count);
  return count % interval === 0;
}

function extractProfileFacts(text: string): string[] {
  const facts: string[] = [];
  const patterns = [
    /(?:我喜欢|我偏好|我习惯|我不喜欢|我讨厌|请始终|请不要|以后请)([^。！？!?\n]{2,120})/gu,
    /(?:我的|我叫)([^。！？!?\n]{2,120})/gu,
    /(?:I prefer|I like|I dislike|My name is|Always|Never)\s+([^.!?\n]{2,120})/giu,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (value) facts.push(value);
    }
  }
  return [...new Set(facts)].slice(0, 8);
}

export function buildMemoryRecords(params: {
  agentId: string;
  sessionKey: string;
  senderId?: string;
  runId?: string;
  messages: NormalizedMessage[];
  createScenario: boolean;
  now?: Date;
}): MemoryRecord[] {
  const now = params.now ?? new Date();
  const createdAt = now.toISOString();
  const userMessages = params.messages.filter((message) => message.role === "user");
  const records: MemoryRecord[] = [];

  for (const message of userMessages) {
    const keywords = extractKeywords(message.content);
    if (keywords.length === 0) continue;
    records.push({
      id: generateId(),
      level: "L1",
      type: "episodic",
      content: message.content.slice(0, 2_000),
      keywords,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      ...(params.senderId ? { senderId: params.senderId } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
      createdAt,
    });

    for (const fact of extractProfileFacts(message.content)) {
      records.push({
        id: generateId(),
        level: "L3",
        type: "profile",
        content: fact,
        keywords: extractKeywords(fact),
        agentId: params.agentId,
        sessionKey: params.sessionKey,
        ...(params.senderId ? { senderId: params.senderId } : {}),
        ...(params.runId ? { runId: params.runId } : {}),
        createdAt,
      });
    }
  }

  if (params.createScenario && userMessages.length > 0) {
    const content = userMessages.map((message) => message.content).join("；").slice(0, 2_000);
    const keywords = extractKeywords(content);
    records.push({
      id: generateId(),
      level: "L2",
      type: "scenario",
      content: `会话场景：${keywords.slice(0, 12).join("、")}。最近用户输入：${content}`,
      keywords,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
      ...(params.senderId ? { senderId: params.senderId } : {}),
      ...(params.runId ? { runId: params.runId } : {}),
      createdAt,
    });
  }

  return records;
}

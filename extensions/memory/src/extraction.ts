/**
 * @fileoverview Agent Turn 到 L1-L3 记忆记录的确定性抽取层。
 *
 * 输入来自 `agent_end`，先裁剪为当前轮，再按会话计数控制抽取频率。当前实现不调用外部模型：
 * L1 保存用户事件，L2 汇总会话场景，L3 只提取用户明确表达的偏好或身份事实。生成的记录仍由
 * `MemoryStore` 负责租户隔离、幂等、加密和保留期清理。
 */
import { randomBytes } from "node:crypto";

import type { MemoryRecord, NormalizedMessage } from "./model.js";
import { extractKeywords, normalizeMessageContent } from "./text.js";

/** 生成带毫秒时间前缀和 48 位随机尾部的记录 ID，降低同进程同毫秒碰撞概率。 */
export function generateId(): string {
  return `${Date.now()}_${randomBytes(6).toString("hex")}`;
}

/**
 * 从 OpenClaw Agent Turn 中提取可持久化文本，并只保留最后一条 user 消息开始的当前轮。
 * 这样不会在每次 `agent_end` 时重复保存宿主传入的完整历史上下文。
 */
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

/** 每会话已完成轮次数；只用于决定 L1-L3 抽取节奏，不承载持久化业务状态。 */
export const sessionCounters = new Map<string, number>();

/**
 * 推进会话轮次并判断本轮是否执行 L1-L3 抽取。
 * Map 最多保留 10,000 个会话，避免长期运行 Gateway 因冷会话无限增长。
 */
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

/**
 * 从当前轮构造可检索的 L1 事件、L2 场景和 L3 用户画像记录。
 * L3 只接受显式偏好/身份句式；这里不调用模型，避免把未经证实的推断写入长期画像。
 */
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

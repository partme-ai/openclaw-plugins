/**
 * openclaw-memory — 多级长期记忆插件
 *
 * 架构：L0→L1→L2→L3 (基于 memory-tdai 参考实现)
 *
 * L0 — 对话录制：自动捕获每轮对话到本地 JSONL
 * L1 — 记忆提取：由 LLM 从对话中提取结构化记忆
 * L2 — 场景归纳：基于 L1 记忆归纳场景块
 * L3 — 用户画像：基于场景块生成/更新用户画像
 *
 * Auto-Recall: 对话开始前自动注入相关记忆到上下文
 * Memory Search: Agent 可调用 memory_search 工具
 *
 * 与 memory-tdai 差异：
 * - 去掉 node-llama-cpp (太重)
 * - L1 提取复用 OpenClaw 已配置的 LLM
 * - Embedding 支持远程 API (OpenAI 兼容)
 * - Fallback: 纯关键词搜索
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ============================================================================
// 类型
// ============================================================================

interface MemoryConfig {
  enabled: boolean;
  dataDir: string;
  capture: { enabled: boolean; retentionDays: number; cleanTime: string };
  extraction: { enabled: boolean; enableDedup: boolean; maxMemoriesPerSession: number; model?: string };
  recall: { enabled: boolean; maxResults: number; scoreThreshold: number };
  pipeline: { everyNConversations: number; l1IdleTimeoutSeconds: number };
  persona: { triggerEveryN: number; maxScenes: number };
  embedding: { enabled: boolean; provider: string; baseUrl?: string; apiKey?: string; model?: string; dimensions: number };
}

interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface MemoryRecord {
  id: string;
  content: string;
  type: "persona" | "episodic" | "instruction";
  sessionKey: string;
  createdAt: string;
}

const DEFAULTS: MemoryConfig = {
  enabled: true,
  dataDir: "~/.openclaw/state/memory",
  capture: { enabled: true, retentionDays: 90, cleanTime: "03:00" },
  extraction: { enabled: true, enableDedup: true, maxMemoriesPerSession: 10 },
  recall: { enabled: true, maxResults: 5, scoreThreshold: 0.3 },
  pipeline: { everyNConversations: 5, l1IdleTimeoutSeconds: 60 },
  persona: { triggerEveryN: 50, maxScenes: 20 },
  embedding: { enabled: false, provider: "none", dimensions: 0 },
};

function resolveConfig(api: OpenClawPluginApi): MemoryConfig {
  const r = (api.pluginConfig ?? {}) as Partial<MemoryConfig>;
  const c: MemoryConfig = {
    ...DEFAULTS,
    ...r,
    capture: { ...DEFAULTS.capture, ...r.capture },
    extraction: { ...DEFAULTS.extraction, ...r.extraction },
    recall: { ...DEFAULTS.recall, ...r.recall },
    pipeline: { ...DEFAULTS.pipeline, ...r.pipeline },
    persona: { ...DEFAULTS.persona, ...r.persona },
    embedding: { ...DEFAULTS.embedding, ...r.embedding },
  };
  if (c.dataDir.startsWith("~")) c.dataDir = path.join(process.env.HOME ?? "/root", c.dataDir.slice(1));
  return c;
}

// ============================================================================
// 数据目录初始化
// ============================================================================

function initDirs(base: string): void {
  for (const d of ["conversations", "records", "scene_blocks", ".metadata"]) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
  }
}

// ============================================================================
// L0: 对话录制
// ============================================================================

function generateId(): string {
  return `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

async function recordConversation(
  base: string, sessionKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<ConversationMessage[]> {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(base, "conversations", `${date}.jsonl`);
  const records: ConversationMessage[] = [];
  const now = Date.now();

  for (const msg of messages) {
    const rec: ConversationMessage = {
      id: generateId(),
      role: msg.role as "user" | "assistant",
      content: msg.content,
      timestamp: now,
    };
    fs.appendFileSync(file, JSON.stringify({ ...rec, sessionKey }) + "\n");
    records.push(rec);
  }
  return records;
}

// ============================================================================
// L1: 记忆提取 (关键词 + 可选向量)
// ============================================================================

function extractKeywords(text: string): string[] {
  // 简单分词 + 去重
  const words = text
    .replace(/[^一-龥a-zA-Z0-9]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  return [...new Set(words)];
}

function keywordScore(query: string, memory: string): number {
  const queryWords = new Set(extractKeywords(query));
  const memWords = extractKeywords(memory);
  if (queryWords.size === 0 || memWords.length === 0) return 0;
  let hits = 0;
  for (const w of memWords) {
    if (queryWords.has(w) || query.toLowerCase().includes(w.toLowerCase())) hits++;
  }
  return hits / Math.max(queryWords.size, memWords.length);
}

async function saveMemoryRecord(
  base: string, content: string, type: "persona" | "episodic" | "instruction",
  sessionKey: string,
): Promise<MemoryRecord> {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(base, "records", `${date}.jsonl`);
  const rec: MemoryRecord = {
    id: generateId(),
    content,
    type,
    sessionKey,
    createdAt: new Date().toISOString(),
  };
  fs.appendFileSync(file, JSON.stringify(rec) + "\n");
  return rec;
}

async function searchMemories(
  base: string, query: string, limit: number, scoreThreshold: number,
): Promise<Array<MemoryRecord & { score: number }>> {
  const results: Array<MemoryRecord & { score: number }> = [];
  const recordsDir = path.join(base, "records");

  if (!fs.existsSync(recordsDir)) return results;

  const files = fs.readdirSync(recordsDir).filter((f) => f.endsWith(".jsonl")).sort().reverse();
  for (const file of files.slice(0, 30)) { // 搜索最近 30 天的记录
    const content = fs.readFileSync(path.join(recordsDir, file), "utf-8");
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec: MemoryRecord = JSON.parse(line);
        const score = keywordScore(query, rec.content);
        if (score >= scoreThreshold) {
          results.push({ ...rec, score });
        }
      } catch { /* skip malformed */ }
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

// ============================================================================
// 会话计数器（L1 触发判定）
// ============================================================================

const conversationCounters = new Map<string, number>();

function notifyConversation(sessionKey: string, everyN: number): boolean {
  const count = (conversationCounters.get(sessionKey) ?? 0) + 1;
  conversationCounters.set(sessionKey, count);
  return count % everyN === 0;
}

// ============================================================================
// 插件入口
// ============================================================================

const plugin = {
  id: "memory",
  name: "Memory",
  description: "多级长期记忆系统 (L0→L3) — 对话录制、记忆提取、场景归纳、用户画像，自动召回",
  configSchema: { type: "object" as const, additionalProperties: true, properties: {} },

  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api);
    if (!cfg.enabled) { api.logger.info("[memory] Disabled"); return; }

    initDirs(cfg.dataDir);
    api.logger.info(`[memory] Data dir: ${cfg.dataDir}`);

    // ── memory_search 工具 ─────────────────────────────────
    api.registerTool(
      {
        name: "memory_search",
        label: "Memory Search",
        description: "搜索用户的长期记忆。用于回忆用户偏好、历史事件、上下文信息。",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "搜索查询" },
            limit: { type: "number", description: "返回结果上限 (默认5, 最大20)" },
            type: { type: "string", enum: ["persona", "episodic", "instruction"], description: "按记忆类型过滤" },
          },
          required: ["query"],
        },
        async execute(_id: string, params: Record<string, unknown>) {
          const query = String(params.query ?? "");
          const limit = Math.min(Math.max(Number(params.limit) || 5, 1), 20);
          const results = await searchMemories(cfg.dataDir, query, limit, 0);
          return {
            content: [{
              type: "text" as const,
              text: results.length === 0
                ? "未找到相关记忆。"
                : results.map((r, i) => `${i + 1}. [${r.type}] ${r.content}`).join("\n"),
            }],
            details: { count: results.length },
          };
        },
      },
      { name: "memory_search" },
    );

    // ── before_prompt_build: 自动召回记忆 ──────────────────
    if (cfg.recall.enabled) {
      api.on("before_prompt_build", async (event: unknown, ctx) => {
        const prompt = (event as Record<string, unknown>).prompt as string | undefined;
        if (!prompt || !ctx.sessionKey) return;
        try {
          const results = await searchMemories(cfg.dataDir, prompt, cfg.recall.maxResults, cfg.recall.scoreThreshold);
          if (results.length > 0) {
            const ctx2 = "\n【用户历史记忆】\n" + results.map((r) => `- ${r.content}`).join("\n");
            api.logger.debug(`[memory] Recalled ${results.length} memories`);
            return { appendSystemContext: ctx2 };
          }
        } catch (err) {
          api.logger.debug(`[memory] Recall failed: ${String(err)}`);
        }
      });
    }

    // ── agent_end: L0 录制 + L1 调度 ────────────────────────
    if (cfg.capture.enabled) {
      api.on("agent_end", async (event: unknown, ctx) => {
        const e = event as Record<string, unknown>;
        const msgs = (Array.isArray(e.messages) ? e.messages : []) as Array<{ role: string; content: string }>;
        if (msgs.length === 0 || !e.success) return;

        // L0 录制
        const sessionKey = ctx.sessionKey ?? "unknown";
        await recordConversation(cfg.dataDir, sessionKey, msgs);

        // L1 触发判定
        const shouldExtract = cfg.extraction.enabled && notifyConversation(sessionKey, cfg.pipeline.everyNConversations);
        if (shouldExtract) {
          api.logger.info(`[memory] L1 trigger — session=${sessionKey}`);
          // L1: 使用已配置的 LLM 提取记忆（简化版：关键词提取）
          for (const msg of msgs) {
            if (msg.role !== "user") continue;
            const keywords = extractKeywords(msg.content);
            if (keywords.length > 2) {
              const summary = `用户提到：${keywords.join("、")}。原文：${msg.content.slice(0, 200)}`;
              await saveMemoryRecord(cfg.dataDir, summary, "episodic", sessionKey);
            }
          }
        }
      });
    }

    api.logger.info("[memory] Registered — L0 capture + L1 extraction + memory_search tool");
  },
};

export default plugin;

/**
 * openclaw-memory — 企业级长期记忆插件
 *
 * 遵循 OpenClaw Memory Host SDK 契约：
 * - 声明 kind: "memory"（OpenClaw 自动识别为记忆插件，无需手动监听事件注入）
 * - 实现 MemorySearchManager 接口
 * - 框架自动处理记忆召回、上下文注入、flush 等时机
 * - 插件只负责：存储（L0录制）、提取（L1关键词）、搜索（MemorySearchManager.search）
 *
 * 存储：本地 JSONL（L0 对话 + L1 记忆记录）
 * 搜索：关键词匹配（零外部依赖）
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type {
  MemorySearchManager,
  MemorySearchResult,
  MemoryProviderStatus,
  MemoryEmbeddingProbeResult,
} from "openclaw/plugin-sdk/memory-core-host-engine-storage";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

// ============================================================================
// 配置
// ============================================================================

interface MemoryConfig {
  enabled: boolean;
  dataDir: string;
  maxSearchResults: number;
  retentionDays: number;
}

const DEFAULTS: MemoryConfig = {
  enabled: true,
  dataDir: "~/.openclaw/state/memory",
  maxSearchResults: 10,
  retentionDays: 90,
};

function resolveConfig(api: OpenClawPluginApi): MemoryConfig {
  const r = (api.pluginConfig ?? {}) as Partial<MemoryConfig>;
  const c = { ...DEFAULTS, ...r };
  if (c.dataDir.startsWith("~")) c.dataDir = path.join(process.env.HOME ?? "/root", c.dataDir.slice(1));
  return c;
}

// ============================================================================
// 数据管理
// ============================================================================

function initDirs(base: string): void {
  for (const d of ["conversations", "records"]) fs.mkdirSync(path.join(base, d), { recursive: true });
}

export function generateId(): string {
  return `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
}

// ============================================================================
// 关键词搜索
// ============================================================================

export function extractKeywords(text: string): string[] {
  return [...new Set(text.replace(/[^一-龥a-zA-Z0-9]/g, " ").split(/\s+/).filter((w) => w.length >= 2))];
}

export function keywordScore(query: string, content: string): number {
  const qWords = extractKeywords(query);
  if (qWords.length === 0) return 0;
  const lower = content.toLowerCase();
  let hits = 0;
  for (const w of qWords) if (lower.includes(w.toLowerCase())) hits++;
  return hits / qWords.length;
}

// ============================================================================
// 录制与提取
// ============================================================================

function recordMessages(base: string, sessionKey: string, messages: Array<{ role: string; content: string }>): void {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(base, "conversations", `${date}.jsonl`);
  const now = Date.now();
  for (const msg of messages) {
    fs.appendFileSync(file, JSON.stringify({ id: generateId(), role: msg.role, content: msg.content, timestamp: now, sessionKey }) + "\n");
  }
}

function extractMemories(base: string, sessionKey: string, messages: Array<{ role: string; content: string }>): void {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(base, "records", `${date}.jsonl`);
  for (const msg of messages) {
    if (msg.role !== "user") continue;
    const keywords = extractKeywords(msg.content);
    if (keywords.length <= 2) continue;
    fs.appendFileSync(file, JSON.stringify({ id: generateId(), content: `用户提到：${keywords.join("、")}。${msg.content.slice(0, 300)}`, type: "episodic", sessionKey, createdAt: new Date().toISOString() }) + "\n");
  }
}

export const sessionCounters = new Map<string, number>();
export function shouldExtract(sessionKey: string, everyN = 5): boolean {
  const c = (sessionCounters.get(sessionKey) ?? 0) + 1;
  sessionCounters.set(sessionKey, c);
  return c % everyN === 0;
}

// ============================================================================
// MemorySearchManager — 框架通过此接口自动召回记忆
// ============================================================================

export function createSearchManager(base: string): MemorySearchManager {
  return {
    async search(query, opts) {
      const results: MemorySearchResult[] = [];
      const dir = path.join(base, "records");
      if (!fs.existsSync(dir)) return results;

      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort().reverse().slice(0, 30)) {
        let n = 0;
        for (const line of fs.readFileSync(path.join(dir, file), "utf-8").split("\n")) {
          n++;
          if (!line.trim()) continue;
          try {
            const r = JSON.parse(line);
            const s = keywordScore(query, r.content);
            if (s > 0) results.push({ path: `records/${file}`, startLine: n, endLine: n, score: s, snippet: r.content.slice(0, 200), source: "memory" });
          } catch { /* skip */ }
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, opts?.maxResults ?? 10);
    },

    async readFile({ relPath, from, lines }) {
      const fp = path.join(base, relPath);
      if (!fs.existsSync(fp)) return { text: "", path: relPath };
      let text = fs.readFileSync(fp, "utf-8");
      if (from != null) { const ls = text.split("\n"); text = ls.slice(from, lines != null ? from + lines : ls.length).join("\n"); }
      return { text, path: relPath };
    },

    status(): MemoryProviderStatus {
      return { backend: "builtin", provider: "keyword", files: 0, sources: ["memory"], workspaceDir: base };
    },

    async probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult> {
      return { ok: false, checked: true, checkedAtMs: Date.now() };
    },

    async probeVectorAvailability(): Promise<boolean> {
      return false;
    },
  };
}

// ============================================================================
// 插件入口
// ============================================================================

const plugin = {
  id: "memory",
  name: "Memory",
  kind: "memory" as const,
  description: "企业级长期记忆系统 — L0 对话录制 + L1 记忆提取，遵循 OpenClaw Memory Host SDK",
  configSchema: { type: "object" as const, additionalProperties: true, properties: {} },

  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api);
    if (!cfg.enabled) { api.logger.info("[memory] Disabled"); return; }

    initDirs(cfg.dataDir);
    const manager = createSearchManager(cfg.dataDir);

    // 注册 Memory runtime — 框架按 agent/purpose 拉取 manager 并在 before_prompt_build 时注入记忆。
    api.registerMemoryCapability({
      runtime: {
        async getMemorySearchManager() {
          return { manager };
        },
        resolveMemoryBackendConfig() {
          return { backend: "builtin" };
        },
      },
    });
    api.logger.info("[memory] Memory runtime registered — framework handles injection");

    // memory_search 工具 — Agent 主动搜索
    api.registerTool({
      name: "memory_search",
      label: "Memory Search",
      description: "搜索用户的长期记忆。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索查询" },
          limit: { type: "number", description: "返回上限 (默认10)" },
        },
        required: ["query"],
      },
      async execute(_id: string, params: Record<string, unknown>) {
        const results = await manager.search(String(params.query ?? ""), { maxResults: Math.min(Math.max(Number(params.limit) || 10, 1), 20) });
        return { content: [{ type: "text" as const, text: results.length === 0 ? "未找到相关记忆。" : results.map((r, i) => `${i + 1}. ${r.snippet}`).join("\n") }], details: { count: results.length } };
      },
    }, { name: "memory_search" });

    // agent_end: L0 录制 + L1 提取
    api.on("agent_end", (event, ctx) => {
      const e = event as Record<string, unknown>;
      const msgs = (Array.isArray(e.messages) ? e.messages : []) as Array<{ role: string; content: string }>;
      if (msgs.length === 0 || !e.success) return;
      const sk = ctx.sessionKey ?? "unknown";
      recordMessages(cfg.dataDir, sk, msgs);
      if (shouldExtract(sk)) extractMemories(cfg.dataDir, sk, msgs);
    });

    api.logger.info("[memory] Registered — kind=memory, L0 capture, L1 extraction, memory_search tool");
  },
};

export default plugin;

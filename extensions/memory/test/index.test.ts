import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { MemoryConfig } from "../src/config.js";
import {
  buildMemoryRecords,
  extractKeywords,
  generateId,
  keywordScore,
  MemoryStore,
  normalizeTurnMessages,
  resolveConfig,
  sessionCounters,
  shouldExtract,
} from "../src/index.js";
import plugin from "../src/index.js";

function config(dataDir: string, overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return {
    enabled: true,
    dataDir,
    maxSearchResults: 10,
    retentionDays: 90,
    extractionInterval: 5,
    maxRecordBytes: 64 * 1024,
    profileScope: "session",
    ...overrides,
  };
}

describe("文本处理", () => {
  it("同时生成中文词组和二元词以改善无空格召回", () => {
    const words = extractKeywords("人工智能 机器学习");
    expect(words).toContain("人工智能");
    expect(words).toContain("人工");
    expect(words).toContain("机器");
  });

  it("英文检索大小写不敏感", () => {
    expect(keywordScore("PYTHON", "I prefer python development")).toBeGreaterThan(0);
  });

  it("空查询不命中", () => {
    expect(keywordScore("", "任意内容")).toBe(0);
  });

  it("规范化 OpenClaw 文本块并仅保留当前轮", () => {
    const messages = normalizeTurnMessages([
      { role: "user", content: "old" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: [{ type: "text", text: "当前问题" }, { type: "image", url: "x" }] },
      { role: "assistant", content: [{ type: "text", text: "当前回答" }] },
    ]);
    expect(messages).toEqual([
      { role: "user", content: "当前问题" },
      { role: "assistant", content: "当前回答" },
    ]);
  });
});

describe("分层提取", () => {
  beforeEach(() => sessionCounters.clear());

  it("按 session 独立控制 L2 提取周期", () => {
    expect(shouldExtract("a", 2)).toBe(false);
    expect(shouldExtract("b", 2)).toBe(false);
    expect(shouldExtract("a", 2)).toBe(true);
  });

  it("生成唯一 ID", () => {
    expect(new Set(Array.from({ length: 100 }, generateId)).size).toBe(100);
  });

  it("普通输入生成 L1，周期点生成 L2", () => {
    const records = buildMemoryRecords({
      agentId: "main",
      sessionKey: "s1",
      messages: [{ role: "user", content: "请分析北京明天的天气" }],
      createScenario: true,
    });
    expect(records.some((record) => record.level === "L1")).toBe(true);
    expect(records.some((record) => record.level === "L2")).toBe(true);
  });

  it("只有明确偏好或身份陈述才生成 L3", () => {
    const records = buildMemoryRecords({
      agentId: "main",
      sessionKey: "s1",
      messages: [{ role: "user", content: "我喜欢简洁的中文回答。明天天气如何？" }],
      createScenario: false,
    });
    expect(records.find((record) => record.level === "L3")?.content).toContain("我喜欢简洁的中文回答");
  });
});

describe("配置校验", () => {
  it("拒绝会被静默截断或夹逼的错误数值", () => {
    expect(() => resolveConfig({ pluginConfig: { retentionDays: 1.5 } } as never)).toThrow("retentionDays");
    expect(() => resolveConfig({ pluginConfig: { maxSearchResults: 101 } } as never)).toThrow("maxSearchResults");
    expect(() => resolveConfig({ pluginConfig: { enabled: "false" } } as never)).toThrow("enabled");
  });

  it("加密密钥至少要求 32 字节", () => {
    process.env.OPENCLAW_MEMORY_TEST_KEY = "too-short";
    expect(() => resolveConfig({
      pluginConfig: { encryptionKeyEnv: "OPENCLAW_MEMORY_TEST_KEY" },
    } as never)).toThrow("at least 32 bytes");
    delete process.env.OPENCLAW_MEMORY_TEST_KEY;
  });
});

describe("MemoryStore", () => {
  let dataDir: string;
  let store: MemoryStore;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-"));
    store = new MemoryStore(config(dataDir));
    await store.initialize();
  });

  afterEach(async () => {
    await store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    delete process.env.OPENCLAW_MEMORY_TEST_KEY;
  });

  async function append(agentId: string, sessionKey: string, runId: string, content: string, profile = false) {
    const messages = [{ role: "user", content }];
    await store.appendTurn({
      id: generateId(), level: "L0", type: "conversation", agentId, sessionKey, runId, messages,
      createdAt: new Date().toISOString(),
    });
    const records = buildMemoryRecords({ agentId, sessionKey, runId, messages, createScenario: false });
    await store.appendRecords(profile ? records : records.filter((record) => record.level !== "L3"));
  }

  it("异步持久化并搜索 L1 记忆", async () => {
    await append("agent-a", "s1", "r1", "用户正在使用 Python 开发服务");
    const results = await store.createSearchManager("agent-a").search("Python 开发", { sessionKey: "s1" });
    expect(results[0]?.snippet).toContain("Python");
    expect(results[0]?.citation).toMatch(/sessions\/[a-f0-9]{32}\/memories\/.*#L1/);
  });

  it("不同 Agent 物理隔离", async () => {
    await append("agent-a", "s1", "r1", "alpha-only-secret");
    expect(await store.createSearchManager("agent-b").search("alpha-only-secret")).toEqual([]);
  });

  it("L1/L2 默认按 session 隔离", async () => {
    await append("agent-a", "s1", "r1", "session-one-topic");
    expect(await store.createSearchManager("agent-a").search("session-one-topic", { sessionKey: "s2" })).toEqual([]);
  });

  it("缺少 sessionKey 时 fail-closed，不扫描会话记忆", async () => {
    await append("agent-a", "s1", "r1", "session-private-topic");
    expect(await store.createSearchManager("agent-a").search("session-private-topic")).toEqual([]);
  });

  it("L3 用户画像默认也按 session 隔离", async () => {
    await append("agent-a", "s1", "r1", "我喜欢中文简洁回答", true);
    const results = await store.createSearchManager("agent-a").search("中文简洁", { sessionKey: "s2" });
    expect(results).toEqual([]);
  });

  it("单用户 Agent 可显式允许 L3 跨 session", async () => {
    await store.close();
    store = new MemoryStore(config(dataDir, { profileScope: "agent" }));
    await store.initialize();
    await append("agent-a", "s1", "r1", "我喜欢中文简洁回答", true);
    const results = await store.createSearchManager("agent-a").search("中文简洁", { sessionKey: "s2" });
    expect(results.some((result) => result.snippet.startsWith("[L3/profile]"))).toBe(true);
  });

  it("相同 runId 不重复写入", async () => {
    const turn = {
      id: generateId(), level: "L0" as const, type: "conversation" as const, agentId: "agent-a",
      sessionKey: "s1", runId: "same-run", messages: [{ role: "user", content: "hello" }],
      createdAt: new Date().toISOString(),
    };
    expect(await store.appendTurn(turn)).toBe(true);
    expect(await store.appendTurn({ ...turn, id: generateId() })).toBe(false);
  });

  it("并发写入不会丢行或破坏 JSONL", async () => {
    await Promise.all(Array.from({ length: 30 }, (_, index) => append("agent-a", "s1", `r-${index}`, `并发消息 ${index}`)));
    const manager = store.createSearchManager("agent-a");
    const root = manager.status().workspaceDir as string;
    const [result] = await manager.search("并发消息", { sessionKey: "s1", maxResults: 100 });
    const file = path.join(root, result!.path);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(30);
    expect(lines.every((line) => Boolean(JSON.parse(line)))).toBe(true);
  });

  it("拒绝目录穿越和 L0 原始对话读取", async () => {
    const manager = store.createSearchManager("agent-a");
    await expect(manager.readFile({ relPath: "../../outside" })).rejects.toThrow("outside");
    await expect(manager.readFile({ relPath: "conversations/2026-01-01.jsonl" })).rejects.toThrow("session-capability");
  });

  it("readFile 支持分页并返回解码后的记录", async () => {
    await append("agent-a", "s1", "r1", "第一页内容");
    await append("agent-a", "s1", "r2", "第二页内容");
    const manager = store.createSearchManager("agent-a");
    const [searchResult] = await manager.search("内容", { sessionKey: "s1" });
    const result = await manager.readFile({
      relPath: searchResult!.path, from: 1, lines: 1,
    });
    expect(result.text).toContain("第二页内容");
    expect(result.lines).toBe(1);
  });

  it("retentionDays 自动清理过期文件", async () => {
    const manager = store.createSearchManager("agent-a");
    await append("agent-a", "s1", "r1", "用于定位会话目录");
    const [result] = await manager.search("定位会话", { sessionKey: "s1" });
    const expired = path.join(path.dirname(path.join(manager.status().workspaceDir as string, result!.path)), "2020-01-01.jsonl");
    fs.mkdirSync(path.dirname(expired), { recursive: true });
    fs.writeFileSync(expired, "{}\n");
    expect(await store.cleanup()).toBe(1);
    expect(fs.existsSync(expired)).toBe(false);
  });

  it("可选 AES-GCM 静态加密且仍可检索", async () => {
    await store.close();
    process.env.OPENCLAW_MEMORY_TEST_KEY = "a-test-secret-with-sufficient-entropy";
    store = new MemoryStore(config(dataDir, { encryptionKeyEnv: "OPENCLAW_MEMORY_TEST_KEY" }));
    await store.initialize();
    await append("agent-a", "s1", "r1", "高度敏感的客户偏好");
    const manager = store.createSearchManager("agent-a");
    const root = manager.status().workspaceDir as string;
    const [result] = await manager.search("客户偏好", { sessionKey: "s1" });
    const raw = fs.readFileSync(path.join(root, result!.path), "utf8");
    expect(raw).not.toContain("高度敏感");
    expect((await manager.search("客户偏好", { sessionKey: "s1" })).length).toBeGreaterThan(0);
  });

  it("加密密钥错误时启动失败而不是静默返回空记忆", async () => {
    await store.close();
    process.env.OPENCLAW_MEMORY_TEST_KEY = "first-production-secret";
    store = new MemoryStore(config(dataDir, { encryptionKeyEnv: "OPENCLAW_MEMORY_TEST_KEY" }));
    await store.initialize();
    await append("agent-a", "s1", "r1", "不可静默丢失的记忆");
    await store.close();

    process.env.OPENCLAW_MEMORY_TEST_KEY = "wrong-production-secret";
    store = new MemoryStore(config(dataDir, { encryptionKeyEnv: "OPENCLAW_MEMORY_TEST_KEY" }));
    await expect(store.initialize()).rejects.toThrow("encryption key validation failed");
  });

  it("批量提取记录同样执行 maxRecordBytes 限制", async () => {
    await store.close();
    store = new MemoryStore(config(dataDir, { maxRecordBytes: 1024 }));
    await store.initialize();
    const records = buildMemoryRecords({
      agentId: "agent-a",
      sessionKey: "s1",
      messages: [{ role: "user", content: "x".repeat(2000) }],
      createScenario: false,
    });
    await expect(store.appendRecords(records)).rejects.toThrow("maxRecordBytes");
  });

  it("重启后 status 仍统计磁盘中的活动文件", async () => {
    await append("agent-a", "s1", "r1", "重启状态统计");
    const before = store.createSearchManager("agent-a").status().files;
    await store.close();
    store = new MemoryStore(config(dataDir));
    await store.initialize();
    expect(store.createSearchManager("agent-a").status().files).toBe(before);
  });

  it("启动时把旧版混合目录迁移到不可枚举的会话目录", async () => {
    const root = store.createSearchManager("agent-a").status().workspaceDir as string;
    await store.close();
    const legacyFile = path.join(root, "memories", "2026-07-01.jsonl");
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    fs.writeFileSync(legacyFile, `${JSON.stringify({
      id: "legacy-1",
      level: "L1",
      type: "episodic",
      content: "旧版迁移记忆",
      keywords: ["旧版迁移"],
      agentId: "agent-a",
      sessionKey: "legacy-session",
      createdAt: "2026-07-01T00:00:00.000Z",
    })}\n`);

    store = new MemoryStore(config(dataDir));
    await store.initialize();
    const [result] = await store.createSearchManager("agent-a").search("旧版迁移", {
      sessionKey: "legacy-session",
    });
    expect(result?.path).toMatch(/^sessions\/[a-f0-9]{32}\/memories\//);
    expect(fs.existsSync(legacyFile)).toBe(false);
    expect(fs.existsSync(path.join(root, ".legacy-backup", "memories", "2026-07-01.jsonl"))).toBe(true);
  });

  it("状态准确声明本地词法检索和安全能力", () => {
    const status = store.createSearchManager("agent-a").status();
    expect(status.provider).toBe("local-lexical");
    expect(status.vector?.enabled).toBe(false);
    expect(status.custom?.isolation).toBe("agent+physical-session");
  });
});

describe("OpenClaw 2026.7.1 插件契约", () => {
  it("通过 service、memory capability、tool factory 和 agent_end 组成完整运行链路", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-plugin-"));
    let service: { start: (context: unknown) => Promise<void>; stop: () => Promise<void> } | undefined;
    let capability: any;
    let toolFactory: any;
    let agentEnd: any;
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const api = {
      registrationMode: "full",
      config: {
        plugins: {
          entries: { memory: { hooks: { allowConversationAccess: true } } },
        },
      },
      pluginConfig: { dataDir, extractionInterval: 1 },
      logger,
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability(value: unknown) { capability = value; },
      registerTool(value: unknown) { toolFactory = value; },
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };

    plugin.register(api as never);
    expect(service).toBeDefined();
    expect(capability?.runtime).toBeDefined();
    expect(typeof toolFactory).toBe("function");
    expect(typeof agentEnd).toBe("function");

    await service!.start({ logger });
    await agentEnd(
      { success: true, runId: "run-contract", messages: [{ role: "user", content: "我喜欢 TypeScript 严格模式" }] },
      { agentId: "main", sessionKey: "session-contract", senderId: "user-1" },
    );
    const { manager } = await capability.runtime.getMemorySearchManager({ agentId: "main" });
    expect((await manager.search("TypeScript", { sessionKey: "session-contract" })).length).toBeGreaterThan(0);
    const tool = toolFactory({ agentId: "main", sessionKey: "session-contract" });
    const result = await tool.execute("call-1", { query: "严格模式" });
    expect(result.details.count).toBeGreaterThan(0);
    await service!.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});

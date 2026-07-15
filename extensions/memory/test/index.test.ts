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
    expect(results[0]?.citation).toMatch(/memories\/.*#L1/);
  });

  it("不同 Agent 物理隔离", async () => {
    await append("agent-a", "s1", "r1", "alpha-only-secret");
    expect(await store.createSearchManager("agent-b").search("alpha-only-secret")).toEqual([]);
  });

  it("L1/L2 默认按 session 隔离", async () => {
    await append("agent-a", "s1", "r1", "session-one-topic");
    expect(await store.createSearchManager("agent-a").search("session-one-topic", { sessionKey: "s2" })).toEqual([]);
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
    const file = path.join(root, "memories", `${new Date().toISOString().slice(0, 10)}.jsonl`);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(30);
    expect(lines.every((line) => Boolean(JSON.parse(line)))).toBe(true);
  });

  it("拒绝目录穿越和 L0 原始对话读取", async () => {
    const manager = store.createSearchManager("agent-a");
    await expect(manager.readFile({ relPath: "../../outside" })).rejects.toThrow("outside");
    await expect(manager.readFile({ relPath: "conversations/2026-01-01.jsonl" })).rejects.toThrow("searchable");
  });

  it("readFile 支持分页并返回解码后的记录", async () => {
    await append("agent-a", "s1", "r1", "第一页内容");
    await append("agent-a", "s1", "r2", "第二页内容");
    const manager = store.createSearchManager("agent-a");
    const result = await manager.readFile({
      relPath: `memories/${new Date().toISOString().slice(0, 10)}.jsonl`, from: 1, lines: 1,
    });
    expect(result.text).toContain("第二页内容");
    expect(result.lines).toBe(1);
  });

  it("retentionDays 自动清理过期文件", async () => {
    const manager = store.createSearchManager("agent-a");
    const root = manager.status().workspaceDir as string;
    const expired = path.join(root, "memories", "2020-01-01.jsonl");
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
    const raw = fs.readFileSync(path.join(root, "memories", `${new Date().toISOString().slice(0, 10)}.jsonl`), "utf8");
    expect(raw).not.toContain("高度敏感");
    expect((await manager.search("客户偏好", { sessionKey: "s1" })).length).toBeGreaterThan(0);
  });

  it("状态准确声明本地词法检索和安全能力", () => {
    const status = store.createSearchManager("agent-a").status();
    expect(status.provider).toBe("local-lexical");
    expect(status.vector?.enabled).toBe(false);
    expect(status.custom?.isolation).toBe("agent+session");
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

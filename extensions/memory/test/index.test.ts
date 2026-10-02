import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    maxSearchBytes: 16 * 1024 * 1024,
    maxReadLines: 200,
    retentionDays: 90,
    extractionInterval: 5,
    maxRecordBytes: 64 * 1024,
    profileScope: "session",
    autoRecall: true,
    autoRecallMaxResults: 5,
    autoRecallMaxChars: 4_000,
    autoRecallTimeoutMs: 1_000,
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
    expect(() => resolveConfig({ pluginConfig: { maxSearchBytes: 1024 } } as never)).toThrow("maxSearchBytes");
    expect(() => resolveConfig({ pluginConfig: { maxReadLines: 0 } } as never)).toThrow("maxReadLines");
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

  it("管理员 maxSearchResults 不能被调用方参数绕过", async () => {
    await store.close();
    store = new MemoryStore(config(dataDir, { maxSearchResults: 2 }));
    await store.initialize();
    await Promise.all(Array.from({ length: 5 }, (_, index) =>
      append("agent-a", "s1", `limited-${index}`, `共同检索词 条目${index}`)));
    const results = await store.createSearchManager("agent-a").search("共同检索词", {
      sessionKey: "s1",
      maxResults: 100,
    });
    expect(results).toHaveLength(2);
  });

  it("拒绝非法搜索数值而不是静默产生异常语义", async () => {
    const manager = store.createSearchManager("agent-a");
    await expect(manager.search("query", { maxResults: Number.NaN })).rejects.toThrow("maxResults");
    await expect(manager.search("query", { minScore: Number.NaN })).rejects.toThrow("minScore");
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

  it("拒绝通过记忆文件软链接读取 Agent 目录外的数据", async () => {
    await append("agent-a", "s1", "symlink-run", "用于生成可读 citation");
    const manager = store.createSearchManager("agent-a");
    const [result] = await manager.search("生成可读", { sessionKey: "s1" });
    const memoryFile = path.join(manager.status().workspaceDir as string, result!.path);
    const outside = path.join(dataDir, "outside.jsonl");
    fs.writeFileSync(outside, '{"secret":"outside"}\n');
    fs.unlinkSync(memoryFile);
    fs.symlinkSync(outside, memoryFile);

    await expect(manager.readFile({ relPath: result!.path })).rejects.toThrow("symlink outside");
  });

  it("响应 AbortSignal，停止已经取消的自动召回扫描", async () => {
    await append("agent-a", "s1", "abort-run", "不应在取消后继续扫描");
    const controller = new AbortController();
    controller.abort();
    await expect(store.createSearchManager("agent-a").search("继续扫描", {
      sessionKey: "s1",
      signal: controller.signal,
    })).rejects.toThrow();
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

  it("readFile 受管理员行数上限约束并严格校验分页参数", async () => {
    await store.close();
    store = new MemoryStore(config(dataDir, { maxReadLines: 1 }));
    await store.initialize();
    await append("agent-a", "s1", "page-1", "分页边界第一条");
    await append("agent-a", "s1", "page-2", "分页边界第二条");
    const manager = store.createSearchManager("agent-a");
    const [result] = await manager.search("分页边界", { sessionKey: "s1" });
    const page = await manager.readFile({ relPath: result!.path, lines: 100 });
    expect(page.lines).toBe(1);
    expect(page.truncated).toBe(true);
    expect(page.nextFrom).toBe(1);
    await expect(manager.readFile({ relPath: result!.path, from: -1 })).rejects.toThrow("from");
    await expect(manager.readFile({ relPath: result!.path, lines: 0 })).rejects.toThrow("lines");
  });

  it("词法搜索遵守跨文件共享的字节预算", async () => {
    await store.close();
    store = new MemoryStore(config(dataDir, {
      maxSearchBytes: 1024 * 1024,
      maxSearchResults: 100,
      maxRecordBytes: 64 * 1024,
    }));
    await store.initialize();
    const records = Array.from({ length: 140 }, (_, index) => ({
      id: `budget-${index}`,
      level: "L1" as const,
      type: "episodic" as const,
      content: `${"x".repeat(8_000)} ${index === 139 ? "budget-tail-marker" : "普通记录"}`,
      keywords: index === 139 ? ["budget-tail-marker"] : ["普通记录"],
      agentId: "agent-a",
      sessionKey: "s1",
      createdAt: new Date().toISOString(),
    }));
    await store.appendRecords(records);
    expect(await store.createSearchManager("agent-a").search("budget-tail-marker", {
      sessionKey: "s1",
    })).toEqual([]);
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

  it("已有明文记忆时禁止直接开启加密，避免产生明密文混合状态", async () => {
    await append("agent-a", "s1", "plain-run", "仍是明文的历史记忆");
    await store.close();

    process.env.OPENCLAW_MEMORY_TEST_KEY = "new-production-secret-with-32-bytes";
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
  it("同配置双 Gateway 生命周期重叠时共享 store，首个 stop 不丢失记忆", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-overlap-"));
    const services: Array<{ stop: () => Promise<void> }> = [];
    const capabilities: any[] = [];
    let agentEnd: any;
    const api = {
      registrationMode: "full",
      source: "/installed/memory/dist/index.js",
      pluginConfig: { dataDir },
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerCli() {},
      registerService(value: { stop: () => Promise<void> }) { services.push(value); },
      registerMemoryCapability(value: unknown) { capabilities.push(value); },
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    plugin.register(api as never);
    plugin.register(api as never);
    const firstHook = agentEnd;
    agentEnd = undefined;
    plugin.register({ ...api, registrationMode: "discovery" } as never);
    expect(typeof agentEnd).toBe("function");
    await agentEnd(
      { success: true, runId: "overlap-1", messages: [{ role: "user", content: "重叠时期的银河绿记忆" }] },
      { agentId: "main", sessionKey: "overlap-session" },
    );
    await services[0]!.stop();
    await firstHook(
      { success: true, runId: "overlap-2", messages: [{ role: "user", content: "旧 generation 仍然存活" }] },
      { agentId: "main", sessionKey: "overlap-session" },
    );
    plugin.register({ ...api, registrationMode: "discovery" } as never);
    expect(typeof agentEnd).toBe("function");
    const { manager } = await capabilities[1].runtime.getMemorySearchManager({ agentId: "main" });
    expect((await manager.search("银河绿", { sessionKey: "overlap-session" })).length).toBeGreaterThan(0);
    expect((await manager.search("旧 generation", { sessionKey: "overlap-session" })).length).toBeGreaterThan(0);
    await services[1]!.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("注册失败后相同配置可以重新注册而没有孤儿 store", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-retry-"));
    let service: { stop: () => Promise<void> } | undefined;
    let agentEnd: unknown;
    let failCapability = true;
    const api = {
      registrationMode: "full",
      pluginConfig: { dataDir },
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() { if (failCapability) throw new Error("registration failed"); },
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    expect(() => plugin.register(api as never)).toThrow("registration failed");
    failCapability = false;
    plugin.register(api as never);
    agentEnd = undefined;
    plugin.register({ ...api, registrationMode: "discovery" } as never);
    expect(typeof agentEnd).toBe("function");
    await service!.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("加密密钥内容轮换时不复用旧 Gateway store", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-key-rotation-"));
    const envName = "OPENCLAW_MEMORY_ROTATION_TEST_KEY";
    const previous = process.env[envName];
    process.env[envName] = "a".repeat(40);
    const services: Array<{ start: (context: unknown) => Promise<void>; stop: () => Promise<void> }> = [];
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const api = {
      registrationMode: "full",
      pluginConfig: { dataDir, encryptionKeyEnv: envName },
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      logger,
      registerCli() {},
      registerService(value: (typeof services)[number]) { services.push(value); },
      registerMemoryCapability() {},
      registerTool() {},
      on() {},
    };
    try {
      plugin.register(api as never);
      await services[0]!.start({ logger });
      process.env[envName] = "b".repeat(40);
      plugin.register(api as never);
      await expect(services[1]!.start({ logger })).rejects.toThrow(/encryption|key/i);
    } finally {
      await Promise.all(services.map((service) => service.stop()));
      if (previous === undefined) delete process.env[envName];
      else process.env[envName] = previous;
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("最后 full owner 停止后存活的 discovery generation 仍能完成写入", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-discovery-lease-"));
    let service: { stop: () => Promise<void> } | undefined;
    let agentEnd: any;
    let dispose: (() => void | Promise<void>) | undefined;
    const api = {
      registrationMode: "full",
      pluginConfig: { dataDir },
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() {},
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    plugin.register(api as never);
    agentEnd = undefined;
    plugin.register({
      ...api,
      registrationMode: "discovery",
      lifecycle: { onDispose(callback: typeof dispose) { dispose = callback; } },
    } as never);
    const scopedHook = agentEnd;
    await service!.stop();
    await scopedHook(
      { success: true, runId: "retained-generation", messages: [{ role: "user", content: "旧 generation 的星云蓝" }] },
      { agentId: "main", sessionKey: "retained-session" },
    );
    const files: string[] = [];
    const visit = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const target = path.join(dir, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (target.endsWith(".jsonl")) files.push(target);
      }
    };
    visit(dataDir);
    expect(files.some((file) => file.includes("/memories/"))).toBe(true);
    await dispose?.();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("start 与最终 stop 交错时不会在关闭后创建清理定时器", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-start-stop-"));
    let service: { start: (context: unknown) => Promise<void>; stop: () => Promise<void> } | undefined;
    let enteredCleanup: (() => void) | undefined;
    let releaseCleanup: (() => void) | undefined;
    const cleanupEntered = new Promise<void>((resolve) => { enteredCleanup = resolve; });
    const cleanupGate = new Promise<void>((resolve) => { releaseCleanup = resolve; });
    const originalCleanup = MemoryStore.prototype.cleanup;
    const cleanup = vi.spyOn(MemoryStore.prototype, "cleanup").mockImplementation(async function (...args) {
      enteredCleanup?.();
      await cleanupGate;
      return originalCleanup.apply(this, args);
    });
    const interval = vi.spyOn(globalThis, "setInterval");
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const api = {
      registrationMode: "full",
      pluginConfig: { dataDir },
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      logger,
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() {},
      registerTool() {},
      on() {},
    };
    try {
      plugin.register(api as never);
      const start = service!.start({ logger });
      await cleanupEntered;
      const stop = service!.stop();
      releaseCleanup?.();
      await Promise.all([start, stop]);
      expect(interval).not.toHaveBeenCalled();
    } finally {
      releaseCleanup?.();
      cleanup.mockRestore();
      interval.mockRestore();
      await service?.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("Gateway stop 等待已接纳的完整 agent_end 写入 L0-L3", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-drain-"));
    let service: { stop: () => Promise<void> } | undefined;
    let agentEnd: any;
    let releaseRecords: (() => void) | undefined;
    let enteredRecords: (() => void) | undefined;
    const recordsEntered = new Promise<void>((resolve) => { enteredRecords = resolve; });
    const recordsGate = new Promise<void>((resolve) => { releaseRecords = resolve; });
    const originalAppendRecords = MemoryStore.prototype.appendRecords;
    const appendRecords = vi.spyOn(MemoryStore.prototype, "appendRecords").mockImplementation(async function (...args) {
      enteredRecords?.();
      await recordsGate;
      return originalAppendRecords.apply(this, args);
    });
    const api = {
      registrationMode: "full",
      pluginConfig: { dataDir, extractionInterval: 1 },
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability() {},
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    try {
      plugin.register(api as never);
      const hook = agentEnd(
        { success: true, runId: "drain-run", messages: [{ role: "user", content: "我喜欢银河绿格式" }] },
        { agentId: "main", sessionKey: "drain-session" },
      );
      await recordsEntered;
      let stopped = false;
      const stop = service!.stop().then(() => { stopped = true; });
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(stopped).toBe(false);
      releaseRecords?.();
      await Promise.all([hook, stop]);
      const files: string[] = [];
      const visit = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const target = path.join(dir, entry.name);
          if (entry.isDirectory()) visit(target);
          else if (target.endsWith(".jsonl")) files.push(target);
        }
      };
      visit(dataDir);
      expect(files.some((file) => file.includes("/conversations/"))).toBe(true);
      expect(files.some((file) => file.includes("/memories/"))).toBe(true);
      expect(files.some((file) => file.includes("/profiles/"))).toBe(true);
    } finally {
      releaseRecords?.();
      appendRecords.mockRestore();
      await service?.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("通过 service、memory capability、tool factory 和 agent_end 组成完整运行链路", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-plugin-"));
    let service: { start: (context: unknown) => Promise<void>; stop: () => Promise<void> } | undefined;
    let capability: any;
    let toolFactory: any;
    let agentEnd: any;
    let beforePromptBuild: any;
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
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability(value: unknown) { capability = value; },
      registerTool(value: unknown) { toolFactory = value; },
      on(name: string, handler: unknown) {
        if (name === "agent_end") agentEnd = handler;
        if (name === "before_prompt_build") beforePromptBuild = handler;
      },
    };

    plugin.register(api as never);
    expect(service).toBeDefined();
    expect(capability?.runtime).toBeDefined();
    expect(typeof toolFactory).toBe("function");
    expect(typeof agentEnd).toBe("function");
    expect(typeof beforePromptBuild).toBe("function");

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

  it("Agent Harness scoped runtime 未启动 service 时仍会惰性初始化并持久化", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-scoped-"));
    let service: { start: (context: unknown) => Promise<void>; stop: () => Promise<void> } | undefined;
    let capability: any;
    let toolFactory: any;
    let agentEnd: any;
    let beforePromptBuild: any;
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const api = {
      registrationMode: "full",
      config: {
        plugins: {
          entries: { memory: { hooks: { allowConversationAccess: true } } },
        },
      },
      pluginConfig: { dataDir, extractionInterval: 1, profileScope: "agent" },
      logger,
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability(value: unknown) { capability = value; },
      registerTool(value: unknown) { toolFactory = value; },
      on(name: string, handler: unknown) {
        if (name === "agent_end") agentEnd = handler;
        if (name === "before_prompt_build") beforePromptBuild = handler;
      },
    };

    plugin.register(api as never);
    const rootService = service;
    const rootCapability = capability;
    service = undefined;
    capability = undefined;
    toolFactory = undefined;
    agentEnd = undefined;
    beforePromptBuild = undefined;
    plugin.register({ ...api, registrationMode: "discovery" } as never);
    expect(service).toBeUndefined();
    expect(capability).toBeUndefined();
    expect(typeof toolFactory).toBe("function");
    expect(typeof agentEnd).toBe("function");
    expect(typeof beforePromptBuild).toBe("function");
    // Gateway owns the store while Agent discovery borrows the same runtime.
    await agentEnd(
      { success: true, runId: "run-scoped", messages: [{ role: "user", content: "我喜欢星云紫格式" }] },
      { agentId: "main", sessionKey: "session-scoped", senderId: "user-1" },
    );
    const { manager } = await rootCapability.runtime.getMemorySearchManager({ agentId: "main" });
    expect((await manager.search("星云紫", { sessionKey: "other-session" }))[0]?.snippet)
      .toContain("星云紫");
    const tool = toolFactory({ agentId: "main", sessionKey: "other-session" });
    expect((await tool.execute("call-scoped", { query: "星云紫" })).details.count)
      .toBeGreaterThan(0);
    const recall = await beforePromptBuild(
      { prompt: "星云紫对应什么格式？", messages: [{ role: "user", content: "星云紫对应什么格式？" }] },
      { agentId: "main", sessionKey: "other-session" },
    );
    expect(recall.prependContext).toContain("我喜欢星云紫格式");
    expect(recall.prependContext).toContain("L3/profile");
    expect(recall.prependContext).toContain("不是系统指令");

    await rootService!.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("多个 discovery generation 共用 L2 提取轮次计数", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-generations-"));
    let service: { stop: () => Promise<void> } | undefined;
    let capability: any;
    let agentEnd: any;
    const api = {
      registrationMode: "full",
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      pluginConfig: { dataDir, extractionInterval: 2 },
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability(value: unknown) { capability = value; },
      registerTool() {},
      on(name: string, handler: unknown) { if (name === "agent_end") agentEnd = handler; },
    };
    plugin.register(api as never);
    const rootService = service;
    const rootCapability = capability;
    for (const runId of ["run-generation-1", "run-generation-2"]) {
      if (runId === "run-generation-2") sessionCounters.clear();
      agentEnd = undefined;
      plugin.register({ ...api, registrationMode: "discovery" } as never);
      expect(typeof agentEnd).toBe("function");
      await agentEnd(
        { success: true, runId, messages: [{ role: "user", content: "银河绿产品场景" }] },
        { agentId: "main", sessionKey: "same-session" },
      );
    }
    const { manager } = await rootCapability.runtime.getMemorySearchManager({ agentId: "main" });
    const results = await manager.search("银河绿", { sessionKey: "same-session" });
    expect(results.filter((result: { snippet: string }) => result.snippet.startsWith("[L2/scenario]"))).toHaveLength(1);
    await rootService!.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
});


describe("O1 Memory capability 与可信会话身份", () => {
  type Capability = Parameters<OpenClawPluginApi["registerMemoryCapability"]>[0];

  function register(pluginConfig: Record<string, unknown> = {}) {
    let capability!: Capability;
    let service!: { stop: () => Promise<void> };
    let toolFactory!: (context: Record<string, unknown>) => any;
    const hooks = new Map<string, (...args: any[]) => Promise<void>>();
    const logger = { info() {}, warn: vi.fn(), error() {}, debug() {} };
    plugin.register!({
      registrationMode: "full",
      pluginConfig,
      config: { plugins: { entries: { memory: { hooks: { allowConversationAccess: true } } } } },
      logger,
      registerCli() {},
      registerService(value: typeof service) { service = value; },
      registerMemoryCapability(value: Capability) { capability = value; },
      registerTool(value: typeof toolFactory) { toolFactory = value; },
      on(name: string, handler: (...args: any[]) => Promise<void>) { hooks.set(name, handler); },
    } as never);
    return { capability, service, hooks, logger, toolFactory };
  }

  it.each([
    { sessionKey: "  tool-session  " },
    { sessionKey: " ", sessionId: "  tool-session  " },
    { sessionId: "  tool-session  " },
  ])("注册工具与写入共用规范化会话身份：%j", async (identity) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-o1-tool-"));
    const { service, hooks, toolFactory } = register({ dataDir, profileScope: "session" });
    try {
      await hooks.get("agent_end")!(
        { success: true, messages: [{ role: "user", content: "我喜欢tool-private-fact" }] },
        { agentId: "main", ...identity },
      );
      const result = await toolFactory({ agentId: "main", ...identity }).execute("same", { query: "tool-private-fact" });
      expect(result.details.count).toBeGreaterThan(0);
      expect(result.details.sessionScoped).toBe(true);
      expect(result.content[0].text).toContain("tool-private-fact");
      const other = await toolFactory({ agentId: "main", sessionKey: "other-session" }).execute("other", { query: "tool-private-fact" });
      expect(other.details.count).toBe(0);
      for (const missing of [{}, { sessionKey: " ", sessionId: " " }]) {
        const empty = await toolFactory({ agentId: "main", ...missing }).execute("missing", {
          query: "tool-private-fact", sessionKey: "tool-session", sessionId: "tool-session",
        });
        expect(empty.details.count).toBe(0);
        expect(empty.details.sessionScoped).toBe(false);
      }
    } finally {
      await service.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("只向模型描述已可调用的真实召回工具", async () => {
    const { capability, service } = register();
    try {
      expect(capability.deterministicRecallToolName).toBe("memory_search");
      expect(capability.promptBuilder).toBeTypeOf("function");
      expect(capability.promptBuilder!({ availableTools: new Set() })).toEqual([]);
      expect(capability.promptBuilder!({ availableTools: new Set(["unrelated_tool"]) })).toEqual([]);
      const prompt = capability.promptBuilder!({ availableTools: new Set(["memory_search"]) }).join("\n");
      expect(prompt).toContain("memory_search");
      expect(prompt).not.toContain("openmem_search");
      // 后端没有公开 artifact 或预压缩 flush 契约，不返回虚假空成功。
      expect(capability.flushPlanResolver).toBeUndefined();
      expect(capability.publicArtifacts).toBeUndefined();
      expect(capability.supportsPrivateTranscriptRecall).not.toBe(true);
    } finally {
      await service.stop();
    }
  });

  it("无身份的成功轮次不写入共享 unknown 桶，sessionId 仍可作为可信后备", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-o1-identity-"));
    const { capability, service, hooks, logger } = register({ dataDir, profileScope: "session" });
    const appendTurn = vi.spyOn(MemoryStore.prototype, "appendTurn");
    const appendRecords = vi.spyOn(MemoryStore.prototype, "appendRecords");
    const event = { success: true, messages: [{ role: "user", content: "我喜欢身份隔离的中文回答" }] };
    try {
      for (const context of [{}, { sessionKey: " ", sessionId: " " }]) {
        await hooks.get("agent_end")!(event, context);
      }
      expect(appendTurn).not.toHaveBeenCalled();
      expect(appendRecords).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("trusted session"));
      await hooks.get("agent_end")!(event, { sessionKey: " ", sessionId: "fallback-session" });
      const { manager } = await capability.runtime!.getMemorySearchManager({ agentId: "main" } as never);
      expect(await manager!.search("身份隔离", { sessionKey: "other-session" })).toEqual([]);
      expect((await manager!.search("身份隔离", { sessionKey: "fallback-session" })).length).toBeGreaterThan(0);
    } finally {
      appendTurn.mockRestore();
      appendRecords.mockRestore();
      await service.stop();
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe('O2 bounded recall cancellation', () => {
  it('retains complete legacy sentence punctuation inside the explicit budget', async () => {
    let recall!: (...args: any[]) => Promise<any>;
    let stop!: () => Promise<void>;
    const ready = vi.spyOn(MemoryStore.prototype, 'initialize').mockResolvedValue();
    const search = vi.spyOn(MemoryStore.prototype, 'createSearchManager').mockReturnValue({ search: async () => [{ citation: 'a', snippet: '我喜欢中文回答' }] } as never);
    plugin.register!({ registrationMode: 'full', pluginConfig: { contextMaxTokens: 1000 }, config: {},
      logger: { info() {}, warn() {} }, registerCli() {}, registerTool() {}, registerMemoryCapability() {},
      registerService(service: { stop: () => Promise<void> }) { stop = service.stop; },
      on(name: string, fn: typeof recall) { if (name === 'before_prompt_build') recall = fn; },
    } as never);
    try {
      const result = await recall({ prompt: 'question' }, {});
      expect(result.prependContext).toContain('我喜欢中文回答。');
      expect(Buffer.byteLength(result.prependContext)).toBeLessThanOrEqual(1000);
    } finally { await stop(); ready.mockRestore(); search.mockRestore(); }
  });

  it.each([false, true])('drops late results after %s timeout/cancellation and propagates signal', async timedOut => {
    let recall!: (...args: any[]) => Promise<unknown>;
    let stop!: () => Promise<void>;
    let finish!: (value: unknown[]) => void;
    let receivedSignal!: AbortSignal;
    const ready = vi.spyOn(MemoryStore.prototype, 'initialize').mockResolvedValue();
    const search = vi.spyOn(MemoryStore.prototype, 'createSearchManager').mockReturnValue({ search: (_query: string, options: { signal: AbortSignal }) => {
      receivedSignal = options.signal;
      return new Promise(resolve => { finish = resolve; });
    } } as never);
    plugin.register!({ registrationMode: 'full', pluginConfig: { contextMaxTokens: 40, autoRecallTimeoutMs: 50 }, config: {},
      logger: { info() {}, warn() {} }, registerCli() {}, registerTool() {}, registerMemoryCapability() {},
      registerService(service: { stop: () => Promise<void> }) { stop = service.stop; },
      on(name: string, fn: typeof recall) { if (name === 'before_prompt_build') recall = fn; },
    } as never);
    let active = true;
    const controller = new AbortController();
    try {
      const pending = recall({ prompt: 'question' }, { signal: controller.signal, hookInvocation: { assertActive() { if (!active) throw Error('expired'); } } });
      await vi.waitFor(() => expect(finish).toBeDefined(), { interval: 1 });
      if (timedOut) {
        expect(await pending).toBeUndefined();
        expect(receivedSignal.aborted).toBe(true);
        finish([{ citation: 'a', snippet: 'late' }]);
      } else {
        active = false; controller.abort(); finish([{ citation: 'a', snippet: 'late' }]);
        expect(receivedSignal.aborted).toBe(true);
        expect(await pending).toBeUndefined();
      }
    } finally { await stop(); ready.mockRestore(); search.mockRestore(); }
  });
  it('rejects invalid allocation without changing the legacy default', () => {
    expect(resolveConfig({ pluginConfig: {} } as never).contextMaxTokens).toBeUndefined();
    for (const contextMaxTokens of [-1, 0.5, '40', null]) expect(() => resolveConfig({ pluginConfig: { contextMaxTokens } } as never)).toThrow('contextMaxTokens');
    expect(resolveConfig({ pluginConfig: { contextMaxTokens: 0 } } as never).contextMaxTokens).toBe(0);
  });
});

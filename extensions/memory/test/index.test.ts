/**
 * openclaw-memory 单元测试
 *
 * 测试范围：关键词提取、得分计算、ID生成、提取周期、
 * MemorySearchManager 搜索/读取/状态/探测、工具执行、配置解析
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  extractKeywords,
  keywordScore,
  generateId,
  shouldExtract,
  sessionCounters,
  createSearchManager,
} from "../src/index.ts";

// ============================================================================
// extractKeywords
// ============================================================================

describe("extractKeywords", () => {
  it("提取中文关键词（>=2字）", () => {
    // 无空格的中文文本被视为一个整体词
    const words = extractKeywords("我想了解人工智能的最新进展");
    expect(words).toContain("我想了解人工智能的最新进展");
    expect(words.length).toBeGreaterThan(0);
    expect(words.every((w) => w.length >= 2)).toBe(true);
  });

  it("提取带空格的中文关键词", () => {
    const words = extractKeywords("人工智能 机器学习 深度学习");
    expect(words).toContain("人工智能");
    expect(words).toContain("机器学习");
    expect(words).toContain("深度学习");
    expect(words).toHaveLength(3);
  });

  it("提取英文单词（>=2字符）", () => {
    const words = extractKeywords("machine learning is amazing");
    expect(words).toContain("machine");
    expect(words).toContain("learning");
    expect(words).toContain("amazing");
  });

  it("中英混合", () => {
    const words = extractKeywords("使用 Python 开发 AI 应用");
    expect(words).toContain("Python");
    expect(words).toContain("使用");
  });

  it("去重", () => {
    const words = extractKeywords("你好 你好 世界");
    const helloCount = words.filter((w) => w === "你好").length;
    expect(helloCount).toBe(1);
  });

  it("过滤单字", () => {
    const words = extractKeywords("我 要 吃饭");
    // "我", "要" 是单字应被过滤
    expect(words.every((w) => w.length >= 2)).toBe(true);
    expect(words).not.toContain("我");
    expect(words).not.toContain("要");
  });

  it("过滤标点符号", () => {
    const words = extractKeywords("Hello, world! 你好，世界。");
    expect(words).not.toContain("");
    expect(words.some((w) => w.includes(","))).toBe(false);
    expect(words.some((w) => w.includes("，"))).toBe(false);
  });

  it("空字符串返回空数组", () => {
    expect(extractKeywords("")).toEqual([]);
  });

  it("只有单字和标点返回空数组", () => {
    expect(extractKeywords("a b c 1 2 3")).toEqual([]);
  });

  it("保留数字字母组合", () => {
    const words = extractKeywords("GPT-4 和 Claude 3.5");
    expect(words.some((w) => w.includes("GPT") || w.includes("4"))).toBe(true);
  });
});

// ============================================================================
// keywordScore
// ============================================================================

describe("keywordScore", () => {
  it("完全匹配返回 1", () => {
    expect(keywordScore("机器学习", "机器学习是AI的重要分支")).toBe(1);
  });

  it("部分匹配返回比例", () => {
    const score = keywordScore("机器学习 深度学习", "机器学习是AI的重要分支");
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it("无匹配返回 0", () => {
    expect(keywordScore("量子计算", "机器学习和深度学习")).toBe(0);
  });

  it("空查询返回 0", () => {
    expect(keywordScore("", "some content")).toBe(0);
  });

  it("大小写不敏感", () => {
    expect(keywordScore("PYTHON", "python programming")).toBe(1);
    expect(keywordScore("python", "PYTHON PROGRAMMING")).toBe(1);
  });

  it("中英文混合查询", () => {
    const score = keywordScore("Python 机器学习", "使用 Python 进行机器学习项目");
    expect(score).toBe(1);
  });

  it("多关键词命中", () => {
    const score = keywordScore("天气 北京 明天", "明天北京的天气怎么样");
    expect(score).toBeGreaterThan(0.5);
  });
});

// ============================================================================
// generateId
// ============================================================================

describe("generateId", () => {
  it("生成时间戳_随机hex格式", () => {
    const id = generateId();
    expect(id).toContain("_");
    const [ts, hex] = id.split("_");
    expect(Number(ts)).toBeGreaterThan(0);
    expect(hex).toHaveLength(8);
  });

  it("每次生成不同值", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateId()));
    expect(ids.size).toBe(50);
  });
});

// ============================================================================
// shouldExtract
// ============================================================================

describe("shouldExtract", () => {
  beforeEach(() => {
    sessionCounters.clear();
  });

  it("第5次调用返回 true", () => {
    for (let i = 0; i < 4; i++) {
      expect(shouldExtract("session-a")).toBe(false);
    }
    expect(shouldExtract("session-a")).toBe(true);
  });

  it("第10次调用再次返回 true", () => {
    for (let i = 0; i < 9; i++) shouldExtract("session-a");
    expect(shouldExtract("session-a")).toBe(true);
  });

  it("不同 session 独立计数", () => {
    for (let i = 0; i < 4; i++) shouldExtract("a");
    expect(shouldExtract("a")).toBe(true);
    // session-b 第一次调用
    expect(shouldExtract("b")).toBe(false);
  });

  it("自定义周期", () => {
    for (let i = 0; i < 2; i++) expect(shouldExtract("s", 3)).toBe(false);
    expect(shouldExtract("s", 3)).toBe(true);
  });

  it("周期为1时每次都返回true", () => {
    expect(shouldExtract("s", 1)).toBe(true);
    expect(shouldExtract("s", 1)).toBe(true);
  });
});

// ============================================================================
// createSearchManager
// ============================================================================

describe("createSearchManager", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "memory-test-"));
    // 创建 records 目录
    fs.mkdirSync(path.join(tmpDir, "records"), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, "conversations"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("search", () => {
    it("空目录返回空结果", async () => {
      const mgr = createSearchManager(tmpDir);
      const results = await mgr.search("anything");
      expect(results).toEqual([]);
    });

    it("搜索匹配的记忆", async () => {
      // 写入测试记忆数据
      const recordsDir = path.join(tmpDir, "records");
      fs.writeFileSync(
        path.join(recordsDir, "2026-05-20.jsonl"),
        [
          JSON.stringify({ id: "1", content: "用户喜欢 Python 编程", type: "episodic", createdAt: "2026-05-20T10:00:00Z" }),
          JSON.stringify({ id: "2", content: "用户需要健身建议", type: "episodic", createdAt: "2026-05-20T11:00:00Z" }),
          JSON.stringify({ id: "3", content: "用户询问天气情况", type: "episodic", createdAt: "2026-05-20T12:00:00Z" }),
        ].join("\n") + "\n"
      );

      const mgr = createSearchManager(tmpDir);
      const results = await mgr.search("Python 编程");
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toContain("Python");
      expect(results[0].source).toBe("memory");
      expect(results[0].path).toContain("records/2026-05-20.jsonl");
    });

    it("搜索结果按得分降序排列", async () => {
      const recordsDir = path.join(tmpDir, "records");
      fs.writeFileSync(
        path.join(recordsDir, "2026-05-20.jsonl"),
        [
          JSON.stringify({ id: "a", content: "天气多云转晴", type: "episodic", createdAt: "2026-05-20T10:00:00Z" }),
          JSON.stringify({ id: "b", content: "今天天气很好", type: "episodic", createdAt: "2026-05-20T11:00:00Z" }),
        ].join("\n") + "\n"
      );

      const mgr = createSearchManager(tmpDir);
      const results = await mgr.search("天气");
      expect(results.length).toBeGreaterThanOrEqual(1);
      // 得分应递减
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });

    it("不匹配时返回空", async () => {
      const recordsDir = path.join(tmpDir, "records");
      fs.writeFileSync(
        path.join(recordsDir, "2026-05-20.jsonl"),
        JSON.stringify({ id: "1", content: "用户喜欢咖啡", type: "episodic", createdAt: "2026-05-20T10:00:00Z" }) + "\n"
      );

      const mgr = createSearchManager(tmpDir);
      const results = await mgr.search("量子力学");
      expect(results).toEqual([]);
    });

    it("限制返回数量", async () => {
      const recordsDir = path.join(tmpDir, "records");
      const lines = Array.from({ length: 20 }, (_, i) =>
        JSON.stringify({ id: String(i), content: `测试数据 ${i}`, type: "episodic", createdAt: `2026-05-20T${String(i).padStart(2, "0")}:00:00Z` })
      ).join("\n") + "\n";
      fs.writeFileSync(path.join(recordsDir, "2026-05-20.jsonl"), lines);

      const mgr = createSearchManager(tmpDir);
      const results = await mgr.search("测试数据", { maxResults: 5 });
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it("跳过损坏的行", async () => {
      const recordsDir = path.join(tmpDir, "records");
      fs.writeFileSync(
        path.join(recordsDir, "2026-05-20.jsonl"),
        "not valid json\n" +
        JSON.stringify({ id: "1", content: "正常数据", type: "episodic", createdAt: "2026-05-20T10:00:00Z" }) + "\n" +
        "{invalid\n"
      );

      const mgr = createSearchManager(tmpDir);
      const results = await mgr.search("正常数据");
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe("readFile", () => {
    it("读取文件内容", async () => {
      const recordsDir = path.join(tmpDir, "records");
      const content = JSON.stringify({ id: "1", content: "test", type: "episodic" }) + "\n";
      fs.writeFileSync(path.join(recordsDir, "2026-05-20.jsonl"), content);

      const mgr = createSearchManager(tmpDir);
      const result = await mgr.readFile({ relPath: "records/2026-05-20.jsonl" });
      expect(result.text).toBe(content);
      expect(result.path).toBe("records/2026-05-20.jsonl");
    });

    it("文件不存在返回空", async () => {
      const mgr = createSearchManager(tmpDir);
      const result = await mgr.readFile({ relPath: "records/nonexistent.jsonl" });
      expect(result.text).toBe("");
    });

    it("指定行范围读取", async () => {
      const recordsDir = path.join(tmpDir, "records");
      fs.writeFileSync(
        path.join(recordsDir, "2026-05-20.jsonl"),
        "line1\nline2\nline3\nline4\nline5\n"
      );

      const mgr = createSearchManager(tmpDir);
      const result = await mgr.readFile({ relPath: "records/2026-05-20.jsonl", from: 1, lines: 2 });
      expect(result.text).toBe("line2\nline3");
    });
  });

  describe("status", () => {
    it("返回 MemoryProviderStatus", () => {
      const mgr = createSearchManager(tmpDir);
      const s = mgr.status();
      expect(s.backend).toBe("builtin");
      expect(s.provider).toBe("keyword");
      expect(Array.isArray(s.sources)).toBe(true);
      expect(s.sources).toContain("memory");
      expect(s.workspaceDir).toBe(tmpDir);
    });
  });

  describe("probeEmbeddingAvailability", () => {
    it("返回不支持（keyword模式）", async () => {
      const mgr = createSearchManager(tmpDir);
      const result = await mgr.probeEmbeddingAvailability();
      expect(result.ok).toBe(false);
      expect(result.checked).toBe(true);
      expect(typeof result.checkedAtMs).toBe("number");
    });
  });

  describe("probeVectorAvailability", () => {
    it("返回 false", async () => {
      const mgr = createSearchManager(tmpDir);
      expect(await mgr.probeVectorAvailability()).toBe(false);
    });
  });
});

// ============================================================================
// 边界和异常
// ============================================================================

describe("Memory 边界条件", () => {
  it("extractKeywords 保留数字字符串（数字属字母数字字符集）", () => {
    const words = extractKeywords("123 4567 89");
    // 数字不在过滤字符集中，>=2位的数字被保留
    expect(words).toContain("123");
    expect(words).toContain("4567");
    expect(words).toContain("89");
  });

  it("extractKeywords 处理仅含英文单字母", () => {
    const words = extractKeywords("a b c d e");
    expect(words).toEqual([]);
  });

  it("keywordScore 处理查询词全部不匹配", () => {
    expect(keywordScore("火星 木星", "地球是太阳系的行星")).toBe(0);
  });

  it("shouldExtract 处理大量 session", () => {
    sessionCounters.clear();
    for (let i = 0; i < 100; i++) {
      shouldExtract(`session-${i}`, 10);
    }
    expect(sessionCounters.size).toBe(100);
    sessionCounters.clear();
  });
});

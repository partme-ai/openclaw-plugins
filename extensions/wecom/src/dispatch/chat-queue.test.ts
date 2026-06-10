/**
 * chat-queue + openclaw-compat 单元测试
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  buildQueueKey,
  hasActiveTask,
  enqueueWeComChatTask,
  getWeComChatQueueSnapshot,
  _resetChatQueueState,
} from "./chat-queue.ts";
import {
  parseOptionalDelimitedEntries,
  formatPairingApproveHint,
  emptyPluginConfigSchema,
} from "../shared/openclaw-compat.ts";

// ============================================================================
// buildQueueKey / hasActiveTask / enqueueWeComChatTask
// ============================================================================

describe("chat-queue", () => {
  beforeEach(() => {
    _resetChatQueueState();
  });

  describe("buildQueueKey", () => {
    it("生成 accountId:chatId 格式", () => {
      expect(buildQueueKey("acct1", "chat1")).toBe("acct1:chat1");
    });

    it("不同参数生成不同 key", () => {
      const k1 = buildQueueKey("a1", "c1");
      const k2 = buildQueueKey("a1", "c2");
      expect(k1).not.toBe(k2);
    });
  });

  describe("hasActiveTask", () => {
    it("空队列无活跃任务", () => {
      expect(hasActiveTask("acct1:chat1")).toBe(false);
    });

    it("入队后有活跃任务", async () => {
      const { promise } = enqueueWeComChatTask({
        accountId: "acct1",
        chatId: "chat1",
        task: () => Promise.resolve(),
      });
      expect(hasActiveTask("acct1:chat1")).toBe(true);
      await promise;
    });
  });

  describe("enqueueWeComChatTask", () => {
    it("首个任务立即执行 status=immediate", () => {
      const { status } = enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: () => Promise.resolve(),
      });
      expect(status).toBe("immediate");
    });

    it("同 key 第二个任务排队 status=queued", () => {
      enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: () => Promise.resolve(),
      });
      const { status } = enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: () => Promise.resolve(),
      });
      expect(status).toBe("queued");
    });

    it("不同 key 互不影响", () => {
      const { status: s1 } = enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: () => Promise.resolve(),
      });
      const { status: s2 } = enqueueWeComChatTask({
        accountId: "a1", chatId: "c2",
        task: () => Promise.resolve(),
      });
      expect(s1).toBe("immediate");
      expect(s2).toBe("immediate");
    });

    it("队列串行执行", async () => {
      const order: number[] = [];
      const t1 = enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: async () => {
          order.push(1);
        },
      });
      const t2 = enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: async () => {
          order.push(2);
        },
      });
      await Promise.all([t1.promise, t2.promise]);
      expect(order).toEqual([1, 2]);
    });

    it("前任务失败后任务仍执行", async () => {
      const order: number[] = [];
      enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: async () => {
          order.push(1);
          throw new Error("fail");
        },
      });
      const { promise } = enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: async () => {
          order.push(2);
        },
      });
      await promise;
      expect(order).toEqual([1, 2]);
    });

    it("任务完成后队列清理", async () => {
      const { promise } = enqueueWeComChatTask({
        accountId: "a1", chatId: "c1",
        task: () => Promise.resolve(),
      });
      await promise;
      // 给 microtask 时间清理
      await new Promise((r) => setTimeout(r, 10));
      expect(hasActiveTask("a1:c1")).toBe(false);
    });

    it("snapshot 暴露队列深度", async () => {
      const gate = { open: false };
      enqueueWeComChatTask({
        accountId: "a1",
        chatId: "c1",
        task: async () => {
          while (!gate.open) await new Promise((r) => setTimeout(r, 5));
        },
      });
      enqueueWeComChatTask({
        accountId: "a1",
        chatId: "c1",
        task: async () => undefined,
      });
      await new Promise((r) => setTimeout(r, 5));
      const snap = getWeComChatQueueSnapshot();
      expect(snap.keys["a1:c1"]?.depth).toBeGreaterThanOrEqual(2);
      gate.open = true;
    });
  });
});

// ============================================================================
// parseOptionalDelimitedEntries
// ============================================================================

describe("parseOptionalDelimitedEntries", () => {
  it("逗号分隔", () => {
    expect(parseOptionalDelimitedEntries("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("分号分隔", () => {
    expect(parseOptionalDelimitedEntries("x;y;z")).toEqual(["x", "y", "z"]);
  });

  it("换行分隔", () => {
    expect(parseOptionalDelimitedEntries("1\n2\n3")).toEqual(["1", "2", "3"]);
  });

  it("混合分隔符", () => {
    expect(parseOptionalDelimitedEntries("a,b;c\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("去除空格", () => {
    expect(parseOptionalDelimitedEntries(" a , b , c ")).toEqual(["a", "b", "c"]);
  });

  it("空字符串返回 undefined", () => {
    expect(parseOptionalDelimitedEntries("")).toBeUndefined();
    expect(parseOptionalDelimitedEntries("  ")).toBeUndefined();
  });

  it("undefined 返回 undefined", () => {
    expect(parseOptionalDelimitedEntries(undefined)).toBeUndefined();
  });
});

// ============================================================================
// formatPairingApproveHint
// ============================================================================

describe("formatPairingApproveHint", () => {
  it("包含配对命令", () => {
    const hint = formatPairingApproveHint("wecom");
    expect(hint).toContain("openclaw pairing list wecom");
    expect(hint).toContain("openclaw pairing approve wecom");
  });

  it("不同渠道", () => {
    expect(formatPairingApproveHint("qqbot")).toContain("qqbot");
    expect(formatPairingApproveHint("lark")).toContain("lark");
  });
});

// ============================================================================
// emptyPluginConfigSchema
// ============================================================================

describe("emptyPluginConfigSchema", () => {
  it("返回合法 JSON Schema", () => {
    const schema = emptyPluginConfigSchema();
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties).toEqual({});
  });
});

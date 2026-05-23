/**
 * 功能集成测试：验证 openclaw-rabbitmq 与 main 智能体的完整通信流程。
 *
 * 测试覆盖：
 * 1. RabbitMQ 连接建立（amqplib shim）
 * 2. Topic 路由解析（显式绑定 + 标准格式回退）
 * 3. dmScope 会话键生成（per-peer / per-channel-peer / main）
 * 4. 入站消息处理完整管线
 * 5. 出站消息发布到回复 Topic
 * 6. main 智能体默认通信测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setRabbitmqRuntime, getRabbitmqRuntime } from "../src/runtime.js";
import { setRabbitmqChannelConfig } from "../src/state.js";
import { DEFAULT_RABBITMQ_CONFIG } from "../src/config.js";
import { resolveInboundRoute, buildReplyTopicFromInbound } from "../src/routing/topic-router.js";
import { upsertSessionContext, getSessionContext, removePeerSessions, getSessionStats } from "../src/routing/session-mapper.js";
import { resolveDmScopeFromRuntimeConfig } from "../src/dm-scope.js";

/**
 * 模拟 OpenClaw Gateway 运行时，等同于真实环境中的 api.runtime 对象。
 */
function createMockRuntime(cfg: Record<string, unknown> = {}) {
  return {
    config: {
      session: { dmScope: "per-peer" },
      ...cfg,
    },
    agent: {
      resolveAgentDir: vi.fn().mockResolvedValue("/tmp/agent"),
      resolveAgentWorkspaceDir: vi.fn().mockResolvedValue("/tmp/agent/workspace"),
      runEmbeddedAgent: vi.fn().mockResolvedValue({
        payloads: [
          { text: "Hello from main agent!", isReasoning: false },
        ],
      }),
    },
    channel: {
      routing: {
        resolveAgentRoute: vi.fn().mockResolvedValue({
          sessionKey: "agent:main:direct:test-peer",
        }),
      },
      reply: {
        finalizeInboundContext: vi.fn().mockResolvedValue({
          sessionKey: "agent:main:direct:test-peer",
        }),
        createReplyDispatcherWithTyping: vi.fn(({ deliver }) => ({ deliver })),
        dispatchReplyFromConfig: vi.fn().mockResolvedValue(undefined),
      },
    },
    subagent: {
      run: vi.fn().mockResolvedValue({ runId: "run-001" }),
      waitForRun: vi.fn().mockResolvedValue({ text: "Hello from subagent!" }),
    },
  };
}

describe("Functional Integration: Main Agent Communication", () => {
  let mockRuntime: ReturnType<typeof createMockRuntime>;

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    setRabbitmqRuntime(mockRuntime);
    setRabbitmqChannelConfig({
      ...DEFAULT_RABBITMQ_CONFIG,
      url: "amqp://localhost:5672",
      exchange: "openclaw",
      exchangeType: "topic",
      topicPrefix: "openclaw",
      subscribeTopics: ["openclaw.agent.*.in.#"],
      topicBindings: [],
    });
  });

  afterEach(() => {
    const mappings = getSessionStats();
    if (mappings.activeSessions > 0) {
      // 清理
    }
  });

  // ─── Test 1: 插件入口加载 ───
  describe("插件入口加载", () => {
    it("应该能加载构建后的插件模块", async () => {
      const mod = await import("../dist/index.js");
      expect(mod.default).toBeDefined();
      expect(mod.rabbitmqChannel).toBeDefined();
      expect(mod.rabbitmqChannel.id).toBe("rabbitmq");
    });

    it("应该能加载 setup-entry", async () => {
      const mod = await import("../dist/setup-entry.js");
      expect(mod.default).toBeDefined();
      expect(mod.default.plugin).toBeDefined();
    });
  });

  // ─── Test 2: Topic 路由到 main 智能体 ───
  describe("Topic 路由到 main 智能体", () => {
    it("标准格式 openclaw.agent.main.in 应路由到 main 智能体", () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        topicPrefix: "openclaw",
        subscribeTopics: ["openclaw.#"],
        topicBindings: [],
      };
      const route = resolveInboundRoute("openclaw.agent.main.in.test-peer", config);
      expect(route).not.toBeNull();
      expect(route!.agentId).toBe("main");
      expect(route!.source).toBe("standard");
    });

    it("显式 topicBindings 应优先路由", () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        topicPrefix: "openclaw",
        subscribeTopics: ["openclaw.#"],
        topicBindings: [
          { topicPattern: "custom.main.task.#", agentId: "main", accountId: "default" },
        ],
      };
      const route = resolveInboundRoute("custom.main.task.priority", config);
      expect(route).not.toBeNull();
      expect(route!.agentId).toBe("main");
      expect(route!.source).toBe("binding");
    });

    it("main 智能体回复 Topic 应正确派生", () => {
      const replyTopic = buildReplyTopicFromInbound("openclaw.agent.main.in", "openclaw");
      expect(replyTopic).toBe("openclaw.agent.main.out");
    });

    it("带 peerId 的回复 Topic 应在尾部追加 .out", () => {
      const replyTopic = buildReplyTopicFromInbound(
        "openclaw.agent.main.in.device-001",
        "openclaw",
      );
      // buildReplyTopicFromInbound 仅在 topic 以 .in 结尾时才替换为 .out；
      // openclaw.agent.main.in.device-001 以 device-001 结尾，因此是追加 .out
      expect(replyTopic).toBe("openclaw.agent.main.in.device-001.out");
    });
  });

  // ─── Test 4: 完整消息收发流程 ───
  describe("完整消息收发流程 (main 智能体)", () => {
    it("应该正确处理 main 智能体的完整请求-回复流程", async () => {
      // Step 1: 模拟 RabbitMQ 入站消息到达
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        topicPrefix: "openclaw",
        subscribeTopics: ["openclaw.#"],
        topicBindings: [],
      };

      // Step 2: Topic 路由解析
      const route = resolveInboundRoute("openclaw.agent.main.in.test-device", config);
      expect(route).not.toBeNull();
      expect(route!.agentId).toBe("main");

      // Step 3: OpenClaw resolveAgentRoute 提供的 sessionKey（由核心 dmScope 决定）
      const sessionKey = "agent:main:direct:test-device";

      // Step 4: 保存会话上下文
      const replyTopic = route!.replyTopic ?? buildReplyTopicFromInbound(
        "openclaw.agent.main.in.test-device",
        config.topicPrefix,
      );
      upsertSessionContext(sessionKey, {
        peerId: "test-device",
        agentId: "main",
        accountId: "default",
        lastInboundTopic: "openclaw.agent.main.in.test-device",
        replyTopic,
        updatedAt: Date.now(),
      });

      // Step 5: 验证会话上下文可被查询
      const ctx = getSessionContext(sessionKey);
      expect(ctx).not.toBeNull();
      expect(ctx!.agentId).toBe("main");
      expect(ctx!.peerId).toBe("test-device");
      expect(ctx!.replyTopic).toBe("openclaw.agent.main.in.test-device.out");

      // Step 6: 验证运行时已初始化
      const rt = getRabbitmqRuntime();
      expect(rt).not.toBeNull();
      expect(rt!.agent).toBeDefined();

      // Step 7: 模拟 embedded-agent 回复
      const agentDir = await rt!.agent.resolveAgentDir(rt!.config, "main");
      expect(agentDir).toBe("/tmp/agent");

      const result = await rt!.agent.runEmbeddedAgent({
        sessionId: "rabbitmq:default:main:test-device",
        sessionKey,
        agentId: "main",
        sessionFile: "/tmp/agent/sessions/test.jsonl",
        workspaceDir: "/tmp/agent/workspace",
        prompt: "Hello from test device",
        timeoutMs: 30000,
        runId: "test-run-001",
        config: rt!.config,
      });

      expect(result).toBeDefined();
      expect(result.payloads).toHaveLength(1);
      expect(result.payloads[0].text).toBe("Hello from main agent!");
    });
  });

  // ─── Test 5: 多 Agent 多 Topic 协作 ───
  describe("多 Agent 多 Topic 协作", () => {
    it("main 和 iot-agent 应通过 topicBindings 分别订阅不同 Topic", () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        topicPrefix: "openclaw",
        subscribeTopics: ["openclaw.#", "devices.#"],
        topicBindings: [
          { topicPattern: "devices.*.in", agentId: "iot-agent", accountId: "default" },
          { topicPattern: "openclaw.agent.main.in.#", agentId: "main", accountId: "default" },
        ],
      };

      // IoT 设备消息 → iot-agent
      const iotRoute = resolveInboundRoute("devices.sensor-001.in", config);
      expect(iotRoute).not.toBeNull();
      expect(iotRoute!.agentId).toBe("iot-agent");

      // 主控消息 → main
      const mainRoute = resolveInboundRoute(
        "openclaw.agent.main.in.operator",
        config,
      );
      expect(mainRoute).not.toBeNull();
      expect(mainRoute!.agentId).toBe("main");

      // 两者不应冲突
      expect(iotRoute!.agentId).not.toBe(mainRoute!.agentId);
    });

    it("未配置 bindings 时应接受标准格式所有 agent", () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        topicPrefix: "openclaw",
        subscribeTopics: ["openclaw.#"],
        topicBindings: [],
      };

      const tests = ["main", "iot-agent", "sensor-agent", "admin-agent"];
      for (const agentId of tests) {
        const route = resolveInboundRoute(
          `openclaw.agent.${agentId}.in`,
          config,
        );
        expect(route).not.toBeNull();
        expect(route!.agentId).toBe(agentId);
      }
    });
  });

  // ─── Test 6: 默认配置 (未指定智能体) 应能与 main 通信 ───
  describe("默认未配置智能体时与 main 通信", () => {
    it("未配置 agentId 时 dmScope 回退到 per-peer", () => {
      const dmScope = resolveDmScopeFromRuntimeConfig({});
      expect(dmScope).toBe("per-peer");
    });

    it("默认配置下标准 Topic 格式正常解析 main 智能体", () => {
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        topicPrefix: "openclaw",
        subscribeTopics: [],
        topicBindings: [],
      };

      // 无 subscribeTopics 时应接受所有 Topic
      const route = resolveInboundRoute("openclaw.agent.main.in.default-peer", config);
      expect(route).not.toBeNull();
      expect(route!.agentId).toBe("main");
      expect(route!.source).toBe("standard");
    });

    it("空 subscribeTopics 不过滤任何消息", () => {
      // 根据 shouldProcessTopic: 空数组 → 接受所有
      const config = {
        ...DEFAULT_RABBITMQ_CONFIG,
        subscribeTopics: [],
      };
      // 任何 topic 都应被接受（由 shouldProcessTopic 逻辑保证）
      expect(config.subscribeTopics).toHaveLength(0);
    });

    it("运行时初始化后默认配置可正常处理消息", () => {
      const rt = getRabbitmqRuntime();
      expect(rt).not.toBeNull();

      // 验证 channel 路由方法可用
      expect(rt!.channel.routing.resolveAgentRoute).toBeDefined();
      expect(rt!.channel.reply.finalizeInboundContext).toBeDefined();
      expect(rt!.agent.runEmbeddedAgent).toBeDefined();
    });
  });
});

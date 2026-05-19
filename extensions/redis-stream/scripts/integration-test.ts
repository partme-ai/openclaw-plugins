/**
 * openclaw-redis-stream 全链路集成测试
 *
 * 测试流程：
 *   1. 启动 Redis Pub/Sub 服务 (defaultAgentId="main")
 *   2. 通过 Redis 发布消息到测试 channel
 *   3. 插件接收 → 路由解析 → 兜底到 main 智能体
 *   4. 验证消息被正确投递（出站 channel 可消费到回复）
 *
 * 用法：
 *   REDIS_URL=redis://localhost:6379 npx tsx scripts/integration-test.ts
 */

import { createClient } from "redis";
import {
  startRedisServer,
  stopRedisServer,
  getStats,
} from "../src/redis-stream-server.js";
import { resolveRedisChannelConfig } from "../src/redis-stream-config.js";
import { setRedisStreamRuntime } from "../src/runtime.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

// ── Mock OpenClaw Runtime ──────────────────────────────────────────
// 模拟最小化的 OpenClaw PluginRuntime，拦截 dispatchReplyFromConfig
// 并验证 agentId 是否为 "main"

let dispatchedAgentId: string | null = null;
let dispatchedText: string | null = null;
let dispatchedSessionKey: string | null = null;
let outboundMessages: Array<{ channel: string; text: string }> = [];

setRedisStreamRuntime({
  config: {},
  channel: {
    routing: {
      resolveAgentRoute: async () => ({ sessionKey: "agent:main:direct:openclaw:agent:main:in" }),
    },
    reply: {
      finalizeInboundContext: async (params: Record<string, unknown>) => params,
      createReplyDispatcherWithTyping: ({ deliver }: { deliver: (p: { text: string }) => Promise<void> }) => ({
        deliver,
      }),
      dispatchReplyFromConfig: async ({
        dispatcher,
        ctx,
      }: {
        dispatcher: { deliver: (p: { text: string }) => Promise<void> };
        ctx: Record<string, unknown>;
      }) => {
        // 记录派发信息
        dispatchedText = (ctx as Record<string, string>).text ?? null;
        // 发送回复到出站 channel
        await dispatcher.deliver({
          text: `[main agent reply] received: ${(ctx as Record<string, string>).text ?? ""}`,
        });
      },
    },
  },
} as unknown as Parameters<typeof setRedisStreamRuntime>[0]);

// ── 主测试流程 ─────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  openclaw-redis-stream 全链路集成测试");
  console.log("  Redis:", REDIS_URL);
  console.log("=".repeat(60));

  // 1. 配置插件
  const config = resolveRedisChannelConfig({
    channels: {
      "redis-stream": {
        url: REDIS_URL,
        defaultAgentId: "main",
        channelMode: "pubsub",
        subscribeChannels: ["openclaw:agent:*:in"], // 仅订阅标准入站 channel，避免出站回环
      },
    },
  });

  console.log("\n📋 配置:");
  console.log(`   url:              ${config.url}`);
  console.log(`   channelMode:      ${config.channelMode}`);
  console.log(`   defaultAgentId:   "${config.defaultAgentId}"`);

  // 2. 启动 Redis 服务（Pub/Sub 模式）
  console.log("\n🔌 启动 Redis 连接...");
  await startRedisServer(config);
  console.log("   ✓ 已连接");

  // 3. 创建测试用的 Redis 客户端
  const testClient = createClient({ url: REDIS_URL });
  await testClient.connect();

  // 4. 订阅出站 channel 来捕获回复
  const replyChannel = "openclaw:agent:main:out";
  const receivedReplies: string[] = [];
  const sub = testClient.duplicate();
  await sub.connect();
  await sub.subscribe(replyChannel, (msg) => {
    receivedReplies.push(msg);
  });
  await sleep(200); // 等待订阅生效

  console.log(`\n📡 监听出站 channel: ${replyChannel}`);

  // 5. 发送测试消息到标准入站格式 channel
  const testChannel = "openclaw:agent:main:in";
  const testMessage = "Hello from integration test!";

  console.log(`\n📤 发送测试消息:`);
  console.log(`   channel: ${testChannel}`);
  console.log(`   message: "${testMessage}"`);

  await testClient.publish(testChannel, testMessage);

  // 等待消息处理（异步分发）
  await sleep(500);

  // 6. 验证结果
  const stats = getStats();
  console.log("\n📊 统计:");
  console.log(`   connected:        ${stats.connected}`);
  console.log(`   messagesRead:     ${stats.messagesRead}`);
  console.log(`   messagesWritten:  ${stats.messagesWritten}`);
  console.log(`   subscribedChannels: ${JSON.stringify(stats.subscribedChannels)}`);

  console.log("\n🔍 路由验证:");
  console.log(`   dispatchedText:   "${dispatchedText}"`);

  const outboundMsgs = receivedReplies.filter((m) => m.includes("[main agent reply]"));
  console.log(`   出站回复数:       ${outboundMsgs.length}`);
  if (outboundMsgs.length > 0) {
    console.log(`   回复内容:         "${outboundMsgs[0]}"`);
  }

  // 7. 断言
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`   ✓ ${label}`);
      passed++;
    } else {
      console.log(`   ✗ FAIL: ${label}`);
      failed++;
    }
  }

  console.log("\n✅ 验证:");
  assert(stats.messagesRead >= 1, "消息被插件接收处理");
  assert(dispatchedText === testMessage, `消息文本被正确派发 (expected "${testMessage}", got "${dispatchedText}")`);
  assert(outboundMsgs.length >= 1, `main 智能体回复成功 (${outboundMsgs.length} 条回复)`);
  assert(
    outboundMsgs[0]?.includes(testMessage) ?? false,
    "回复包含原始消息内容",
  );
  assert(stats.messagesWritten >= 1, "出站消息写入计数增长");

  // 8. 清理
  console.log("\n🧹 清理...");
  await sub.unsubscribe(replyChannel);
  await sub.quit();
  await testClient.quit();
  await stopRedisServer();

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  结果: ${passed}/${passed + failed} 通过`);
  if (failed > 0) {
    console.log(`  失败项: ${failed}`);
    process.exit(1);
  } else {
    console.log("  ✅ 全链路集成测试通过！");
  }
  console.log("=".repeat(60));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("集成测试崩溃:", err);
  process.exit(1);
});

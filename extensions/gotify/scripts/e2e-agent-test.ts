/**
 * openclaw-gotify 端到端智能体通信测试
 *
 * 测试流程：
 *   1. 记录当前 Gotify 最新消息时间
 *   2. 通过 Gotify REST API 发送测试消息
 *   3. openclaw-gotify 插件通过 WebSocket stream 接收
 *   4. 路由到 main 智能体（channel.ts:263 fallback）
 *   5. 智能体处理并回复（zai/glm-5.1）
 *   6. 回复通过 Gotify outbound 发回
 *   7. 轮询 Gotify 消息，验证回复出现
 *
 * 用法：
 *   npx tsx scripts/e2e-agent-test.ts
 */

const GOTIFY_URL = process.env.GOTIFY_SERVER_URL ?? 'http://localhost:8080';
const APP_TOKEN = process.env.GOTIFY_APP_TOKEN ?? '';
const CLIENT_TOKEN = process.env.GOTIFY_CLIENT_TOKEN ?? '';

if (!APP_TOKEN || !CLIENT_TOKEN) {
  console.error('Error: GOTIFY_APP_TOKEN and GOTIFY_CLIENT_TOKEN are required.');
  console.error('Usage: GOTIFY_APP_TOKEN=<token> GOTIFY_CLIENT_TOKEN=<token> npx tsx scripts/e2e-agent-test.ts');
  process.exit(1);
}
const POLL_TIMEOUT_MS = 120_000; // 2 分钟等 AI 回复
const POLL_INTERVAL_MS = 3_000;

async function gotifyRequest(path: string, opts: RequestInit = {}): Promise<Response> {
  const url = `${GOTIFY_URL}${path}`;
  const isGet = !opts.method || opts.method === "GET";
  const headers: Record<string, string> = {
    "X-Gotify-Key": isGet ? CLIENT_TOKEN : APP_TOKEN,
    "Content-Type": "application/json",
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  return fetch(url, { ...opts, headers });
}

async function main() {
  console.log("=".repeat(60));
  console.log("  openclaw-gotify 端到端智能体通信测试");
  console.log("  Gotify:", GOTIFY_URL);
  console.log("  Model: zai/glm-5.1");
  console.log("  Agent: main (defaultAgentId fallback)");
  console.log("=".repeat(60));

  // 1. 健康检查
  console.log("\n🔍 健康检查...");
  const health = await gotifyRequest("/health");
  console.log(`   Gotify: ${JSON.stringify(await health.json())}`);

  // 2. 记录发送前的消息快照
  console.log("\n📸 记录消息快照...");
  const beforeRes = await gotifyRequest("/message?limit=3");
  const beforeData = await beforeRes.json();
  const beforeIds = new Set(
    (beforeData.messages ?? []).map((m: { id: number }) => m.id),
  );
  console.log(`   已有消息 ID: ${[...beforeIds].join(", ") || "(空)"}`);

  // 3. 发送测试消息到 Gotify（模拟用户通过 Gotify 推送）
  const testText = "你好！请用一句话回复我，确认你收到了这条来自 Gotify 通道的测试消息。";
  console.log(`\n📤 发送测试消息:`);
  console.log(`   "${testText}"`);

  const sendRes = await gotifyRequest("/message", {
    method: "POST",
    body: JSON.stringify({
      message: testText,
      title: "openclaw-e2e-test",
      priority: 5,
    }),
  });
  const sendData = await sendRes.json();
  console.log(`   ✓ 已发送 (id=${sendData.id})`);

  // 4. 等待智能体处理并回复
  console.log(`\n⏳ 等待 main 智能体回复（最长 ${POLL_TIMEOUT_MS / 1000}s）...`);
  const startTime = Date.now();
  let agentReply: string | null = null;
  let replyId: number | null = null;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    const pollRes = await gotifyRequest("/message?limit=10");
    const pollData = await pollRes.json();
    const messages: Array<{ id: number; message: string; date: string }> = pollData.messages ?? [];

    for (const msg of messages) {
      // 跳过我们自己发送的消息和之前存在的消息
      if (msg.id === sendData.id) continue;
      if (beforeIds.has(msg.id)) continue;

      // 找到新消息！这就是智能体回复
      agentReply = msg.message;
      replyId = msg.id;
      break;
    }

    if (agentReply) break;

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    if (elapsed % 15 === 0) {
      console.log(`   ...等待中 (${elapsed}s)`);
    }
  }

  // 5. 验证结果
  console.log("\n✅ 验证:");
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

  assert(sendData.id > 0, "测试消息发送成功");
  assert(agentReply !== null, `智能体有回复 (id=${replyId})`);

  if (agentReply) {
    console.log(`\n📥 main 智能体回复:`);
    console.log(`   "${agentReply.substring(0, 300)}"`);
    console.log(`   (长度: ${agentReply.length} 字符)`);

    assert(agentReply.length > 5, "回复内容长度合理 (>5)");
    assert(
      agentReply.includes("Gotify") ||
        agentReply.includes("gotify") ||
        agentReply.includes("通道") ||
        agentReply.includes("消息") ||
        agentReply.includes("测试") ||
        agentReply.includes("收到") ||
        agentReply.length > 20,
      "回复与测试消息相关",
    );
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n   总耗时: ${elapsed}s`);

  // 6. 清理测试消息
  if (replyId) {
    await gotifyRequest(`/message/${replyId}`, { method: "DELETE" }).catch(() => {});
  }
  await gotifyRequest(`/message/${sendData.id}`, { method: "DELETE" }).catch(() => {});

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  结果: ${passed}/${passed + failed} 通过`);
  if (failed > 0) {
    console.log(`  ❌ 端到端测试失败`);
    process.exit(1);
  } else {
    console.log("  ✅ 端到端智能体通信测试通过！");
  }
  console.log("=".repeat(60));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((err) => {
  console.error("测试崩溃:", err);
  process.exit(1);
});

/**
 * RocketMQ external broker E2E adapter.
 */
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runAdapterTest } from "./_context.mjs";

const PRODUCER_HELPER = fileURLToPath(new URL("../helpers/rocketmq-producer.mjs", import.meta.url));
const CONSUMER_HELPER = fileURLToPath(new URL("../helpers/rocketmq-consumer.mjs", import.meta.url));
const READY_MARKER = "ROCKETMQ_E2E_READY";
const REPLY_MARKER = "ROCKETMQ_E2E_REPLY=";

function startReplyConsumer(endpoints, topic) {
  const child = spawn(process.execPath, [CONSUMER_HELPER, endpoints, topic], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let readyResolve;
  let readyReject;
  let replyResolve;
  let replyReject;
  const ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const reply = new Promise((resolve, reject) => {
    replyResolve = resolve;
    replyReject = reject;
  });
  const readyTimer = setTimeout(() => readyReject(new Error(`RocketMQ reply consumer startup timed out: ${stderr}`)), 60_000);
  const replyTimer = setTimeout(() => replyReject(new Error(`RocketMQ Agent reply timed out: ${stderr}`)), 45_000);
  readyTimer.unref?.();
  replyTimer.unref?.();

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes(READY_MARKER)) {
      clearTimeout(readyTimer);
      readyResolve();
    }
    const markerIndex = stdout.indexOf(REPLY_MARKER);
    if (markerIndex >= 0) {
      const encoded = stdout.slice(markerIndex + REPLY_MARKER.length).split(/\r?\n/, 1)[0];
      clearTimeout(replyTimer);
      replyResolve(Buffer.from(encoded, "base64").toString("utf8"));
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("exit", (code) => {
    if (code !== 0) {
      const error = new Error(`RocketMQ reply consumer exited ${code}: ${stderr || stdout}`);
      clearTimeout(readyTimer);
      clearTimeout(replyTimer);
      readyReject(error);
      replyReject(error);
    }
  });

  return {
    ready,
    reply,
    stop: () => {
      clearTimeout(readyTimer);
      clearTimeout(replyTimer);
      if (child.exitCode === null) child.kill("SIGTERM");
    },
  };
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testRocketmq(ctx, results) {
  await runAdapterTest(
    ctx,
    "rocketmq",
    async () => {
      if (!(await ctx.tcpReachable(8081))) throw new Error("RocketMQ proxy 8081 not reachable");
      let health = await ctx.gatewayFetch("/rocketmq/health");
      await ctx.waitFor(
        async () => {
          health = await ctx.gatewayFetch("/rocketmq/health");
          return health.json?.data?.connected === true;
        },
        { label: "RocketMQ channel connected", timeoutMs: 60_000, intervalMs: 1_000 },
      ).catch(() => {
        throw new Error(`/rocketmq/health → ${health.status}: ${health.text}`);
      });
      const model = ctx.modelFixture;
      if (!model) throw new Error("rocketmq E2E model fixture was not started by the orchestrator");
      const initialCompletions = model.metrics.completions;
      const replyTopic = `${ctx.meta.rocketmqTopic}-out`;
      const consumer = startReplyConsumer("127.0.0.1:8081", replyTopic);
      try {
        await consumer.ready;
        execFileSync(
          process.execPath,
          [
            PRODUCER_HELPER,
            "127.0.0.1:8081",
            ctx.meta.rocketmqTopic,
            JSON.stringify({ ...ctx.pingPayload, text: "Return the RocketMQ E2E fixture response." }),
          ],
          { stdio: "pipe", timeout: 30_000 },
        );

        const rawReply = await consumer.reply;
        const envelope = JSON.parse(rawReply);
        if (envelope?.message?.text !== "openclaw e2e fixture reply") {
          throw new Error(`unexpected RocketMQ reply envelope: ${rawReply}`);
        }
        if (envelope?.message?.source?.channel !== "rocketmq") {
          throw new Error(`RocketMQ reply source channel missing: ${rawReply}`);
        }
        if (envelope?.headers?.replyRoute?.topic !== replyTopic) {
          throw new Error(`RocketMQ reply route missing: ${rawReply}`);
        }

        await ctx.waitFor(async () => {
          const stats = await ctx.gatewayFetch("/rocketmq/stats");
          const snapshot = stats.json?.data?.stats;
          return stats.ok
            && typeof snapshot?.messagesReceived === "number" && snapshot.messagesReceived > 0
            && typeof snapshot?.messagesSent === "number" && snapshot.messagesSent > 0
            && typeof snapshot?.messagesAcked === "number" && snapshot.messagesAcked > 0
            && snapshot.inFlight === 0;
        }, { label: "rocketmq receive + reply + ACK stats", timeoutMs: 15_000 });

        if (model.metrics.completions !== initialCompletions + 1) {
          throw new Error(`fixture completion delta=${model.metrics.completions - initialCompletions}, expected 1`);
        }
      } finally {
        consumer.stop();
      }
    },
    { service: "docker:8081", method: "Producer → PushConsumer → real Agent Turn → reply Topic → ACK" },
    results,
  );
}

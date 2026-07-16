import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { dockerEnv, DOCKER } from "../lib/compose.mjs";
import { startOpenAiModelFixture } from "../helpers/openai-model-fixture.mjs";
import { runAdapterTest } from "./_context.mjs";

const execFileAsync = promisify(execFile);
const req = createRequire(new URL("../../../extensions/mqtt/package.json", import.meta.url));
const mqtt = req("mqtt");

async function collectorLogs() {
  const { stdout, stderr } = await execFileAsync(
    DOCKER,
    ["logs", "openclaw-e2e-otel-collector"],
    { env: dockerEnv(), maxBuffer: 2 * 1024 * 1024 },
  );
  return `${stdout}\n${stderr}`;
}

function runInboundTurn(ctx) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error("Timed out waiting for MQTT agent reply"));
    }, 30_000);
    const client = mqtt.connect("mqtt://127.0.0.1:11883", {
      clientId: `tracing-e2e-${Date.now()}`,
      reconnectPeriod: 0,
    });
    const finish = (error, value) => {
      clearTimeout(timeout);
      client.end(true);
      if (error) reject(error);
      else resolve(value);
    };
    client.once("error", (error) => finish(error));
    client.once("connect", () => {
      client.subscribe("openclaw/agent/main/out", (subscribeError) => {
        if (subscribeError) {
          finish(subscribeError);
          return;
        }
        client.publish(
          "openclaw/agent/main/in",
          JSON.stringify({
            ...ctx.pingPayload,
            text: "Return the tracing fixture response.",
            metadata: { ...ctx.pingPayload.metadata, e2e: "tracing" },
          }),
          (publishError) => {
            if (publishError) finish(publishError);
          },
        );
      });
    });
    client.on("message", (_topic, payload) => {
      const text = payload.toString("utf8");
      if (text.includes("tracing e2e reply")) finish(undefined, text);
    });
  });
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testTracing(ctx, results) {
  await runAdapterTest(
    ctx,
    "tracing",
    async () => {
      if (!ctx.pluginIds.includes("mqtt")) {
        throw new Error("tracing E2E requires the mqtt plugin to exercise a real inbound channel turn");
      }
      const model = await startOpenAiModelFixture(ctx.ports.modelFixture);
      try {
        await ctx.waitFor(() => ctx.tcpReachable(11883), {
          label: "MQTT inbound fixture",
          timeoutMs: 30_000,
        });
        await runInboundTurn(ctx);
        if (model.metrics.completions !== 1) {
          throw new Error(`fixture completion count=${model.metrics.completions}, expected 1`);
        }

        await ctx.waitFor(async () => {
          const logs = await collectorLogs();
          return logs.includes("message.received") && logs.includes("openclaw.channel");
        }, { label: "tracing spans in OpenTelemetry Collector", timeoutMs: 30_000, intervalMs: 500 });

        const status = await ctx.gatewayFetch("/tracing/status");
        if (!status.ok || status.json?.data?.backend !== "otlp") {
          throw new Error(`tracing status failed: ${status.status} ${status.text}`);
        }
        if (status.json?.data?.backendStatus?.healthy !== true || status.json?.data?.backendStatus?.bufferedSpans !== 0) {
          throw new Error(`tracing backend not drained and healthy: ${status.text}`);
        }
      } finally {
        await model.close();
      }
    },
    {
      service: `http://127.0.0.1:${ctx.ports.otlpHttp}/v1/traces`,
      method: "MQTT inbound + real Agent Turn + local OpenAI fixture + OTLP/HTTP Collector export",
    },
    results,
  );
}

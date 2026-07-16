import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dockerEnv, DOCKER } from "../lib/compose.mjs";
import { OPENCLAW_BIN, PROFILE } from "../lib/utils.mjs";
import { startOpenAiModelFixture } from "../helpers/openai-model-fixture.mjs";
import { runAdapterTest } from "./_context.mjs";

const execFileAsync = promisify(execFile);

async function collectorLogs() {
  const { stdout, stderr } = await execFileAsync(
    DOCKER,
    ["logs", "openclaw-e2e-otel-collector"],
    { env: dockerEnv(), maxBuffer: 2 * 1024 * 1024 },
  );
  return `${stdout}\n${stderr}`;
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testTracing(ctx, results) {
  await runAdapterTest(
    ctx,
    "tracing",
    async () => {
      const model = await startOpenAiModelFixture(ctx.ports.modelFixture);
      try {
        const { stdout } = await execFileAsync(
          OPENCLAW_BIN,
          [
            "--profile", PROFILE,
            "agent",
            "--agent", "main",
            "--session-id", `tracing-e2e-${Date.now()}`,
            "--message", "Return the tracing fixture response.",
            "--model", "e2e-fixture/fixture-model",
            "--thinking", "off",
            "--timeout", "60",
            "--json",
          ],
          { maxBuffer: 2 * 1024 * 1024, timeout: 90_000 },
        );
        if (!stdout.includes("tracing e2e reply")) {
          throw new Error(`agent response did not contain fixture reply: ${stdout.slice(0, 500)}`);
        }
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
      method: "real OpenClaw agent turn + local OpenAI fixture + OTLP/HTTP Collector export",
    },
    results,
  );
}

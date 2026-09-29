import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { dockerEnv, DOCKER } from "../lib/compose.mjs";
import { runAdapterTest } from "./_context.mjs";
import { MANAGEMENT_E2E_GATEWAY_TOKEN } from "../lib/config.mjs";

const authorized = { headers: { Authorization: `Bearer ${MANAGEMENT_E2E_GATEWAY_TOKEN}` } };

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
      if (text.includes("openclaw e2e fixture reply")) finish(undefined, text);
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
      const deniedStatuses = [];
      for (const path of ["/tracing/status", "/tracing/traces?limit=1", "/tracing/trace?traceId=00000000000000000000000000000000"]) {
        const anonymous = await ctx.gatewayFetch(path);
        if (![401, 403].includes(anonymous.status) || anonymous.json?.data !== undefined) {
          throw new Error(`anonymous GET ${path} exposed traces (${anonymous.status})`);
        }
        deniedStatuses.push(`${path}:${anonymous.status}`);
      }
      const invalid = await ctx.gatewayFetch("/tracing/status", { headers: { Authorization: "Bearer invalid-e2e-token" } });
      if (![401, 403].includes(invalid.status) || invalid.json?.data !== undefined) {
        throw new Error(`invalid token exposed tracing status (${invalid.status})`);
      }
      const authorizedStatus = await ctx.gatewayFetch("/tracing/status", authorized);
      if (!authorizedStatus.ok || authorizedStatus.json?.data?.plugin !== "tracing") {
        throw new Error(`authorized tracing status failed (${authorizedStatus.status})`);
      }
      console.log(`[tracing-auth] anonymous GET ${deniedStatuses.join(", ")}; invalid token=${invalid.status}; authorized status=${authorizedStatus.status}`);
      const model = ctx.modelFixture;
      if (!model) throw new Error("tracing E2E model fixture was not started by the orchestrator");
      const initialCompletions = model.metrics.completions;
      await ctx.waitFor(() => ctx.tcpReachable(11883), {
        label: "MQTT inbound fixture",
        timeoutMs: 30_000,
      });
      await runInboundTurn(ctx);
      if (model.metrics.completions !== initialCompletions + 1) {
        throw new Error(`fixture completion delta=${model.metrics.completions - initialCompletions}, expected 1`);
      }

      try {
        await ctx.waitFor(async () => {
          const logs = await collectorLogs();
          return logs.includes("message.received") && logs.includes("openclaw.channel");
        }, { label: "tracing spans in OpenTelemetry Collector", timeoutMs: 30_000, intervalMs: 500 });
      } catch (error) {
        const logs = await collectorLogs();
        const status = await ctx.gatewayFetch("/tracing/status", authorized);
        const receivedCount = logs.match(/message\.received/g)?.length ?? 0;
        const channelCount = logs.match(/openclaw\.channel/g)?.length ?? 0;
        console.log(`[tracing-otlp] Collector message.received=${receivedCount}, openclaw.channel=${channelCount}; status=${status.status}; activeSpans=${status.json?.data?.activeSpans}, recentTraces=${status.json?.data?.recentTraces}, backend=${status.json?.data?.backend}, bufferedSpans=${status.json?.data?.backendStatus?.bufferedSpans}`);
        throw error;
      }

      const status = await ctx.gatewayFetch("/tracing/status", authorized);
      if (!status.ok || status.json?.data?.backend !== "otlp") {
        throw new Error(`tracing status failed: ${status.status} ${status.text}`);
      }
      if (status.json?.data?.activeSpans !== 0 || status.json?.data?.recentTraces < 1) {
        throw new Error(`tracing lifecycle did not close and retain the completed trace: ${status.text}`);
      }
      if (status.json?.data?.backendStatus?.healthy !== true || status.json?.data?.backendStatus?.bufferedSpans !== 0) {
        throw new Error(`tracing backend not drained and healthy: ${status.text}`);
      }
      const traces = await ctx.gatewayFetch("/tracing/traces?limit=1", authorized);
      if (!traces.ok || !Array.isArray(traces.json?.data) || traces.json.data.length !== 1) {
        throw new Error(`authorized trace listing failed (${traces.status})`);
      }
      const detail = await ctx.gatewayFetch(`/tracing/trace?traceId=${traces.json.data[0].traceId}`, authorized);
      if (!detail.ok || detail.json?.data?.traceId !== traces.json.data[0].traceId) {
        throw new Error(`authorized trace detail failed (${detail.status})`);
      }
    },
    {
      service: `http://127.0.0.1:${ctx.ports.otlpHttp}/v1/traces`,
      method: "MQTT inbound + real Agent Turn + local OpenAI fixture + OTLP/HTTP Collector export",
    },
    results,
  );
}

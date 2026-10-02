import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { dockerEnv, DOCKER } from "../lib/compose.mjs";
import { runAdapterTest } from "./_context.mjs";
import { MANAGEMENT_E2E_GATEWAY_TOKEN } from "../lib/config.mjs";
import { restartInstalledGateway } from "../lib/lifecycle.mjs";

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

/** Match one new, terminal Agent turn in both the shared journal and OTLP Collector. */
export function selectCompletedTurnTrace({ beforeTraceIds, nonce, summaries, spansByTraceId, collectorLog }) {
  if (typeof nonce !== "string" || nonce.length === 0) return null;
  for (const summary of summaries) {
    const traceId = summary?.traceId;
    if (typeof traceId !== "string" || !/^[a-f0-9]{32}$/i.test(traceId) || beforeTraceIds.has(traceId)) continue;
    if (!Number.isFinite(summary.endTimeMs) || summary.endTimeMs < summary.startTimeMs) continue;
    const root = spansByTraceId.get(traceId)?.find((span) =>
      span.traceId === traceId && !span.parentSpanId &&
      ["message.received", "agent.run"].includes(span.name) &&
      span.status === "ok" && Number.isFinite(span.endTimeMs) &&
      span.endTimeMs >= span.startTimeMs &&
      typeof span.attributes?.["openclaw.message_text"] === "string" &&
      span.attributes["openclaw.message_text"].includes(nonce) &&
      ["agent_end_success", "reply_payload_final"].includes(span.attributes?.["openclaw.end_reason"]),
    );
    if (!root) continue;
    if (collectorHasSpan(collectorLog, root)) {
      return { traceId, spanId: root.spanId };
    }
  }
  return null;
}

function collectorHasSpan(log, root) {
  const starts = [...log.matchAll(/^[ \t]*Span #\d+[ \t]*$/gm)].map((match) => match.index);
  for (let index = 0; index < starts.length; index += 1) {
    const block = log.slice(starts[index], starts[index + 1] ?? log.length);
    const field = (name) => block.match(new RegExp(`^[ \\t]*${name}[ \\t]*:[ \\t]*([^\\r\\n]*)`, "m"))?.[1]?.trim();
    if (field("Trace ID")?.toLowerCase() === root.traceId.toLowerCase() &&
        field("ID")?.toLowerCase() === root.spanId.toLowerCase() &&
        field("Name") === root.name) return true;
  }
  return false;
}

function collectorHasTelemetrySpan(log, name, identity) {
  return collectorTelemetrySpanCount(log, name, identity) > 0;
}

function collectorTelemetrySpanCount(log, name, identity) {
  const starts = [...log.matchAll(/^[ \t]*Span #\d+[ \t]*$/gm)].map((match) => match.index);
  return starts.filter((start, index) => {
    const block = log.slice(start, starts[index + 1] ?? log.length);
    return block.includes(`Name           : ${name}`) && (!identity || block.includes(identity));
  }).length;
}

export function runInboundTurn(ctx, nonce, deliveryId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.end(true);
      reject(new Error("Timed out waiting for MQTT agent reply"));
    }, 30_000);
    const client = mqtt.connect("mqtt://127.0.0.1:11883", {
      clientId: `tracing-e2e-${nonce}`,
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
            text: `Return the tracing fixture response. trace_nonce=${nonce}`,
            ...(deliveryId ? { idempotencyKey: deliveryId } : {}),
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
      if (text.includes(`openclaw e2e fixture reply ${nonce}`)) finish(undefined, text);
    });
  });
}

/** @param {ReturnType<import('./_context.mjs').createTestContext>} ctx */
/** @param {import('../lib/utils.mjs').resultRow extends (...args: never) => infer R ? R[] : never} results */
export async function testTracing(ctx, results) {
  const evidence = {};
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
        const invalid = await ctx.gatewayFetch(path, { headers: { Authorization: "Bearer invalid-e2e-token" } });
        if (![401, 403].includes(invalid.status) || invalid.json?.data !== undefined) {
          throw new Error(`invalid token exposed ${path} (${invalid.status})`);
        }
        deniedStatuses.push(`${path}:anonymous=${anonymous.status},invalid=${invalid.status}`);
      }
      const anonymousPost = await ctx.gatewayFetch("/tracing/status", { method: "POST" });
      if (![401, 403].includes(anonymousPost.status) || anonymousPost.json?.data !== undefined) {
        throw new Error(`anonymous POST /tracing/status exposed traces (${anonymousPost.status})`);
      }
      const authorizedPost = await ctx.gatewayFetch("/tracing/status", { method: "POST", ...authorized });
      if (authorizedPost.status !== 405) {
        throw new Error(`authorized POST /tracing/status bypassed GET-only route (${authorizedPost.status})`);
      }
      const authorizedStatus = await ctx.gatewayFetch("/tracing/status", authorized);
      if (!authorizedStatus.ok || authorizedStatus.json?.data?.plugin !== "tracing") {
        throw new Error(`authorized tracing status failed (${authorizedStatus.status})`);
      }
      console.log(`[tracing-auth] denied GET ${deniedStatuses.join(", ")}; anonymous POST=${anonymousPost.status}, authorized POST=${authorizedPost.status}; authorized status=${authorizedStatus.status}`);
      const model = ctx.modelFixture;
      if (!model) throw new Error("tracing E2E model fixture was not started by the orchestrator");
      const nonce = randomUUID();
      const o6DeliveryId = process.env.OPENCLAW_E2E_O6 === "1" ? `o6-delivery-${randomUUID()}` : undefined;
      const initialCompletions = model.metrics.completions;
      const initialTraces = await ctx.gatewayFetch("/tracing/traces?limit=200", authorized);
      if (!initialTraces.ok || !Array.isArray(initialTraces.json?.data)) {
        throw new Error(`authorized baseline trace listing failed (${initialTraces.status})`);
      }
      const beforeTraceIds = new Set(initialTraces.json.data.map((trace) => trace.traceId));
      await ctx.waitFor(() => ctx.tcpReachable(11883), {
        label: "MQTT inbound fixture",
        timeoutMs: 30_000,
      });
      const previousReplyText = model.controls.replyText;
      model.controls.replyText = `openclaw e2e fixture reply ${nonce}`;
      try {
        await runInboundTurn(ctx, nonce, o6DeliveryId);
      } finally {
        model.controls.replyText = previousReplyText;
      }
      if (model.metrics.completions !== initialCompletions + 1) {
        throw new Error(`fixture completion delta=${model.metrics.completions - initialCompletions}, expected 1`);
      }
      if (!JSON.stringify(model.metrics.lastRequest).includes(nonce)) {
        throw new Error("tracing nonce did not reach the model fixture request");
      }

      let completedTrace = null;
      await ctx.waitFor(async () => {
        const traces = await ctx.gatewayFetch("/tracing/traces?limit=200", authorized);
        if (!traces.ok || !Array.isArray(traces.json?.data)) return false;
        const spansByTraceId = new Map();
        for (const trace of traces.json.data) {
          if (beforeTraceIds.has(trace.traceId)) continue;
          const detail = await ctx.gatewayFetch(`/tracing/trace?traceId=${trace.traceId}`, authorized);
          if (detail.ok && detail.json?.data?.traceId === trace.traceId && Array.isArray(detail.json.data.spans)) {
            spansByTraceId.set(trace.traceId, detail.json.data.spans);
          }
        }
        completedTrace = selectCompletedTurnTrace({
          beforeTraceIds,
          nonce,
          summaries: traces.json.data,
          spansByTraceId,
          collectorLog: await collectorLogs(),
        });
        return completedTrace !== null;
      }, { label: "this completed Agent turn in the journal and OTLP Collector", timeoutMs: 30_000, intervalMs: 500 });
      const status = await ctx.gatewayFetch("/tracing/status", authorized);
      if (!status.ok || status.json?.data?.backend !== "otlp") {
        throw new Error(`tracing status failed: ${status.status} ${status.text}`);
      }
      if (status.json?.data?.backendStatus?.healthy !== true || status.json?.data?.backendStatus?.bufferedSpans !== 0) {
        throw new Error(`tracing backend not drained and healthy: ${status.text}`);
      }
      console.log(`[tracing-otlp] completed traceId=${completedTrace.traceId}, spanId=${completedTrace.spanId}; gatewayActiveSpans=${status.json?.data?.activeSpans}, gatewayActiveTraces=${status.json?.data?.activeTraces}, journalRecentTraces=${status.json?.data?.recentTraces}`);
      if (o6DeliveryId) {
        if (!ctx.pluginIds.includes("memory")) throw new Error("O6 tracing E2E requires installed memory recall");
        const journalId = createHash("sha256").update(JSON.stringify(["local", `tracing-e2e-${nonce}`, o6DeliveryId])).digest("hex");
        const token = `id_${createHash("sha256").update(journalId).digest("hex").slice(0, 24)}`;
        await ctx.waitFor(async () => {
          const logs = await collectorLogs();
          return collectorHasTelemetrySpan(logs, "delivery.started", token) &&
            collectorHasTelemetrySpan(logs, "delivery.settlement", token) &&
            collectorHasTelemetrySpan(logs, "memory.recall") &&
            !logs.includes(o6DeliveryId);
        }, { label: "O6 delivery telemetry in OTLP Collector with hashed identity", timeoutMs: 30_000, intervalMs: 500 });
        const collectorLog = await collectorLogs();
        const startedCount = collectorTelemetrySpanCount(collectorLog, "delivery.started", token);
        const settledCount = collectorTelemetrySpanCount(collectorLog, "delivery.settlement", token);
        if (startedCount !== 1 || settledCount !== 1) {
          throw new Error(`O6 delivery spans duplicated or missing: started=${startedCount}, settlement=${settledCount}`);
        }
        evidence.o6 = { collectorSpanNames: ["delivery.started", "delivery.settlement", "memory.recall"],
          deliveryIdHash: token, startedCount, settledCount,
          rawDeliveryIdAbsent: true, agentDeliveryCorrelation: "unavailable-host-trace-scope" };
        console.log(`[o6-tracing] OTLP received delivery.started and delivery.settlement identity=${token}, memory.recall; raw delivery ID absent`);
      }
      await restartInstalledGateway(ctx);
      await ctx.waitFor(async () => {
        try {
          const restarted = await ctx.gatewayFetch("/tracing/status", authorized);
          return restarted.ok && restarted.json?.data?.backendStatus?.healthy === true;
        } catch { return false; }
      }, { label: "Tracing backend after Gateway restart", timeoutMs: 30_000 });
      const restartedStatus = await ctx.gatewayFetch("/tracing/status", authorized);
      const retainedTrace = await ctx.gatewayFetch(`/tracing/trace?traceId=${completedTrace.traceId}`, authorized);
      const restartedAnonymous = await ctx.gatewayFetch("/tracing/status");
      if (restartedStatus.json?.data?.backend !== "otlp" || restartedStatus.json?.data?.activeTraces !== 0 ||
          retainedTrace.json?.data?.traceId !== completedTrace.traceId || restartedAnonymous.status !== 401) {
        throw new Error(`Tracing restart changed backend/auth/journal state: ${restartedStatus.text}`);
      }
    },
    {
      service: `http://127.0.0.1:${ctx.ports.otlpHttp}/v1/traces`,
      method: "MQTT Agent Turn + OTLP export + Gateway stop/restart backend and journal recovery",
      ...(process.env.OPENCLAW_E2E_O6 === "1" ? { evidence } : {}),
    },
    results,
  );
}

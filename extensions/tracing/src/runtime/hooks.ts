/**
 * @fileoverview OpenClaw 生命周期事件到 Trace/Span 状态机的适配层。
 *
 * message_received 创建根 Span，before/after_tool_call 管理工具子 Span，最终回复或 agent_end
 * 幂等结束 Trace，session_end 则关闭异常中断链路。默认不采集消息正文；显式开启时也只保留
 * 有界片段。Hook 错误会记录但不应阻断 Agent 主业务流程。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { TracingBackend, TracingConfig } from "../shared/types.js";
import { TracingSampler } from "./sampler.js";
import {
  bindToolSpan,
  createSpan,
  endSpan,
  finishActiveTrace,
  incrementSpanCount,
  randomHexId,
  registerActiveTrace,
  resolveActiveTrace,
  takeToolSpanId,
} from "./trace-store.js";

export interface TracingHookContext {
  backend: TracingBackend;
  sampler: TracingSampler;
  config: TracingConfig;
}

export type TracingHookContextProvider = () =>
  | TracingHookContext
  | null
  | Promise<TracingHookContext | null>;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readMessageContent(event: Record<string, unknown>, captureBody: boolean): string | undefined {
  if (!captureBody || typeof event.content !== "string") return undefined;
  return event.content.slice(0, 500);
}

function readTraceId(value: unknown): string | undefined {
  const traceId = readString(value);
  return traceId && /^[a-fA-F0-9]{32}$/.test(traceId) ? traceId.toLowerCase() : undefined;
}

function logHookError(api: OpenClawPluginApi, operation: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  api.logger.error(`[tracing] ${operation} failed: ${message}`);
}

/** hooks 只注册一次，通过 provider 获取当前 gateway 生命周期的后端。 */
export function registerTracingPluginHooks(
  api: OpenClawPluginApi,
  getContext: TracingHookContextProvider,
): void {
  const hookOpts = { priority: 100 };

  api.on(
    "message_received",
    async (event, ctx) => {
      const hookContext = await getContext();
      if (!hookContext) return;
      const { backend, sampler, config } = hookContext;
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(ctx.runId);
      const channelId = readString(ctx.channelId) ?? "unknown";
      const traceId = readTraceId(ctx.traceId) ?? randomHexId(16);
      if (!sampler.shouldSample(traceId)) return;

      const previous = resolveActiveTrace(sessionKey, runId);
      if (previous) {
        try {
          await finishActiveTrace(sessionKey, runId, "error", backend, "superseded_by_new_message");
        } catch (error) {
          logHookError(api, "closing superseded trace", error);
        }
      }
      const messageText = readMessageContent(event as Record<string, unknown>, config.captureMessageBody);
      const messageId = readString(ctx.messageId);
      const rootSpan = createSpan("message.received", {
        traceId,
        kind: "server",
        attributes: {
          "openclaw.channel": channelId,
          ...(sessionKey ? { "openclaw.session_key": sessionKey } : {}),
          ...(runId ? { "openclaw.run_id": runId } : {}),
          ...(messageId ? { "openclaw.message_id": messageId } : {}),
          ...(messageText ? { "openclaw.message_text": messageText } : {}),
        },
      });
      registerActiveTrace({
        traceId,
        rootSpanId: rootSpan.spanId,
        spanCount: 1,
        sessionKey,
        runId,
      });
    },
    hookOpts,
  );

  api.on(
    "before_tool_call",
    async (event, ctx) => {
      const hookContext = await getContext();
      if (!hookContext) return;
      const toolCallId = readString(event.toolCallId);
      if (!toolCallId) return;
      const active = resolveActiveTrace(readString(ctx.sessionKey), readString(ctx.runId));
      if (!active || !incrementSpanCount(active, hookContext.config.maxSpansPerTrace)) return;

      const toolName = readString(event.toolName) ?? "unknown";
      const span = createSpan(`tool:${toolName}`, {
        traceId: active.traceId,
        parentSpanId: active.rootSpanId,
        kind: "client",
        attributes: {
          "openclaw.tool_name": toolName,
          "openclaw.tool_call_id": toolCallId,
        },
      });
      bindToolSpan(toolCallId, span.spanId, active.traceId);
    },
    hookOpts,
  );

  api.on(
    "after_tool_call",
    async (event) => {
      const hookContext = await getContext();
      if (!hookContext) return;
      const toolCallId = readString(event.toolCallId);
      const spanId = toolCallId ? takeToolSpanId(toolCallId) : undefined;
      if (!spanId) return;
      try {
        await endSpan(spanId, event.error ? "error" : "ok", hookContext.backend, {
          durationMs: typeof event.durationMs === "number" ? event.durationMs : undefined,
          attributes: event.error ? { "openclaw.tool_error": String(event.error).slice(0, 500) } : undefined,
        });
      } catch (error) {
        logHookError(api, "exporting tool span", error);
      }
    },
    hookOpts,
  );

  api.on(
    "reply_payload_sending",
    async (event, ctx) => {
      const hookContext = await getContext();
      if (!hookContext || event.kind !== "final") return;
      try {
        await finishActiveTrace(
          readString(event.sessionKey) ?? readString(ctx.sessionKey),
          readString(event.runId) ?? readString(ctx.runId),
          "ok",
          hookContext.backend,
          "reply_payload_final",
        );
      } catch (error) {
        logHookError(api, "ending reply trace", error);
      }
    },
    hookOpts,
  );

  // Custom channel dispatchers (including the Message SDK wire bridges) can
  // deliver replies without traversing OpenClaw's standard outbound hook path.
  // agent_end is the host-wide terminal signal for the Agent run, so use it as
  // an idempotent fallback. Standard channels normally close the trace from
  // reply_payload_sending first; finishActiveTrace then makes this a no-op.
  api.on(
    "agent_end",
    async (event, ctx) => {
      const hookContext = await getContext();
      if (!hookContext) return;
      const runId = readString(event.runId) ?? readString(ctx.runId);
      try {
        await finishActiveTrace(
          readString(ctx.sessionKey),
          runId,
          event.success ? "ok" : "error",
          hookContext.backend,
          event.success ? "agent_end_success" : "agent_end_error",
        );
      } catch (error) {
        logHookError(api, "ending agent trace", error);
      }
    },
    hookOpts,
  );

  api.on(
    "session_end",
    async (_event, ctx) => {
      const hookContext = await getContext();
      if (!hookContext) return;
      try {
        await finishActiveTrace(
          readString(ctx.sessionKey),
          readString((ctx as { runId?: unknown }).runId),
          "error",
          hookContext.backend,
          "session_end_before_final_reply",
        );
      } catch (error) {
        logHookError(api, "ending session trace", error);
      }
    },
    hookOpts,
  );

  api.logger.info("[tracing] Hooks registered (message_received, tool, reply_payload_sending, agent_end, session_end)");
}

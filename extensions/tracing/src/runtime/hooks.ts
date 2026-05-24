/**
 * OpenClaw Plugin Hooks 集成 — 使用 api.on 注册 typed hooks。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import type { TracingBackend, TracingConfig } from "../shared/types.js";
import { TracingSampler } from "./sampler.js";
import {
  bindToolSpan,
  clearActiveTrace,
  createSpan,
  endSpan,
  incrementSpanCount,
  randomHexId,
  registerActiveTrace,
  resolveActiveTrace,
  takeToolSpanId,
} from "./trace-store.js";

/** Hook 注册上下文 */
export interface TracingHookContext {
  backend: TracingBackend;
  sampler: TracingSampler;
  config: TracingConfig;
}

/**
 * 从 hook context 读取字符串字段。
 */
function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 从 event / ctx 提取消息正文（可选捕获）。
 */
function readMessageContent(
  event: Record<string, unknown>,
  captureBody: boolean,
): string | undefined {
  if (!captureBody) {
    return undefined;
  }
  const content = event.content;
  if (typeof content === "string") {
    return content.slice(0, 500);
  }
  return undefined;
}

/**
 * 注册 Plugin Hooks（priority 100，优先于 router/prometheus 观测 hook）。
 */
export function registerTracingPluginHooks(api: OpenClawPluginApi, hookCtx: TracingHookContext): void {
  const { backend, sampler, config } = hookCtx;
  const hookOpts = { priority: 100 };

  api.on(
    "message_received",
    (event, ctx) => {
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(ctx.runId);
      const channelId = readString(ctx.channelId) ?? "unknown";
      const traceId = readString(ctx.traceId) ?? randomHexId(16);

      if (!sampler.shouldSample(traceId)) {
        return;
      }

      const rootSpan = createSpan("message.received", {
        traceId,
        kind: "server",
        attributes: {
          "openclaw.channel": channelId,
          ...(sessionKey ? { "openclaw.session_key": sessionKey } : {}),
          ...(runId ? { "openclaw.run_id": runId } : {}),
          ...(readString(ctx.messageId) ? { "openclaw.message_id": readString(ctx.messageId)! } : {}),
          ...(readMessageContent(event as Record<string, unknown>, config.captureMessageBody)
            ? {
                "openclaw.message_text": readMessageContent(
                  event as Record<string, unknown>,
                  config.captureMessageBody,
                )!,
              }
            : {}),
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
    (event, ctx) => {
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(ctx.runId);
      const active = resolveActiveTrace(sessionKey, runId);
      if (!active) {
        return;
      }
      if (!incrementSpanCount(active, config.maxSpansPerTrace)) {
        return;
      }

      const toolName = readString(event.toolName) ?? "unknown";
      const span = createSpan(`tool:${toolName}`, {
        traceId: active.traceId,
        parentSpanId: active.rootSpanId,
        kind: "client",
        attributes: {
          "openclaw.tool_name": toolName,
          ...(readString(event.toolCallId) ? { "openclaw.tool_call_id": readString(event.toolCallId)! } : {}),
        },
      });

      const toolCallId = readString(event.toolCallId);
      if (toolCallId) {
        bindToolSpan(toolCallId, span.spanId);
      }
    },
    hookOpts,
  );

  api.on(
    "after_tool_call",
    async (event, ctx) => {
      const toolCallId = readString(event.toolCallId);
      const spanId = toolCallId ? takeToolSpanId(toolCallId) : undefined;
      if (!spanId) {
        return;
      }

      const status = event.error ? "error" : "ok";
      const span = await endSpan(spanId, status, backend);
      if (span && typeof event.durationMs === "number") {
        span.startTimeMs = Date.now() - event.durationMs;
      }
    },
    hookOpts,
  );

  api.on(
    "agent_end",
    async (_event, ctx) => {
      const sessionKey = readString(ctx.sessionKey);
      const runId = readString(ctx.runId);
      const active = resolveActiveTrace(sessionKey, runId);
      if (!active) {
        return;
      }

      const success = (_event as { success?: boolean }).success !== false;
      await endSpan(active.rootSpanId, success ? "ok" : "error", backend);
      clearActiveTrace(sessionKey, runId);
    },
    hookOpts,
  );

  api.on(
    "session_end",
    (_event, ctx) => {
      clearActiveTrace(readString(ctx.sessionKey));
    },
    hookOpts,
  );

  api.logger.info("[openclaw-tracing] Plugin hooks registered (message_received, tool, agent_end, session_end)");
}

/**
 * @module dispatch/channel-dispatch
 *
 * Wire 通道统一 dispatch 路由：按 mode 选择 reply-pipeline / embedded-agent / subagent。
 *
 * **职责**：MQ/机器通道的统一入口；解析 agentId/sessionKey 后按 mode 分流，
 * 避免 RabbitMQ、MQTT、Redis Stream 等插件重复维护派发逻辑。
 *
 * **关键导出**：`dispatchChannelMessage`
 */

import { resolveChannelDispatchIdentity } from "../bridge/resolve-channel-route.js";
import type { BridgePluginRuntime } from "../bridge/types.js";
import { dispatchWireMessage, type WireDispatchOptions } from "./wire-dispatch.js";
import { dispatchEmbeddedAgentMessage } from "./embedded-dispatch.js";
import { dispatchSubagentMessage } from "./subagent-dispatch.js";
import { createHash } from "node:crypto";
import { createDeliveryJournal, PendingDeliveryReconciliationError } from "./delivery-journal.js";
import { resolveOpenClawStateDir } from "../openclaw/state-dir.js";
import { emitDeliveryTelemetry } from "../transport/telemetry.js";
import type {
  ChannelDispatchMode,
  ChannelDispatchParams,
  ChannelDispatchResult,
  EmbeddedAgentRuntime,
  SubagentRuntime,
} from "./types.js";

function fingerprintInbound(params: ChannelDispatchParams): string {
  // Include semantic inbound content and routing only. Transport retry metadata
  // (for example MQTT DUP or receive timestamps) can change on redelivery.
  // OpenClaw's MsgContext uses PascalCase fields, and inbound-bridge spreads
  // extra after its defaults. Those overrides can change the Agent prompt,
  // route, authorization, or media even when the transport text is unchanged.
  const contextOverrides = Object.entries(params.extra ?? {})
    .filter(([key]) => /^[A-Z]/.test(key))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, value === undefined ? { undefined: true } : value]);
  const stableContext = params.deliveryFingerprintContext;
  const canonical = JSON.stringify({
    channel: params.channel,
    accountId: params.accountId,
    peerId: stableContext ? stableContext.peerId : params.peerId,
    chatType: params.chatType,
    mode: params.mode ?? "reply-pipeline",
    text: params.text,
    unified: params.unified ? {
      messageId: params.unified.messageId,
      source: params.unified.source,
      target: params.unified.target,
      contentType: params.unified.contentType,
      text: params.unified.text,
      markdown: params.unified.markdown,
      media: params.unified.media,
      replyToMessageId: params.unified.replyToMessageId,
      direction: params.unified.direction,
    } : null,
    agentId: params.agentId,
    sessionKey: stableContext ? stableContext.sessionKey : params.sessionKey,
    sessionId: params.sessionId,
    childSessionKey: params.childSessionKey,
    replyEnabled: params.replyEnabled,
    sourceFingerprint: params.deliveryFingerprint,
    contextOverrides,
    replyRoute: stableContext ? stableContext.replyRoute : params.reply.replyRoute,
    replyAgentId: params.reply.agentId,
    replySessionKey: params.reply.sessionKey,
    replyUserId: params.reply.userId,
    outboundFormat: params.reply.outboundFormat,
  }, (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
    }
    return value;
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * 按 dispatch.mode 将入站消息路由到对应 SDK 实现 / Route inbound message by dispatch mode.
 *
 * - `reply-pipeline`：OpenClaw dispatchInbound + reply pipeline
 * - `embedded-agent`：进程内 runEmbeddedAgent → serialize → deliver
 * - `subagent`：子 Agent run → waitForRun → deliver
 *
 * sessionKey / agentId 未提供时经 OpenClaw resolveAgentRoute 解析。
 *
 * @param params - 通道、账号、peer、文本、mode、Runtime、reply 配置
 * @param wireOptions - 仅 reply-pipeline 使用的 Wire 队列选项
 * @returns 按 mode 区分的派发结果
 */
export async function dispatchChannelMessage(
  params: ChannelDispatchParams,
  wireOptions?: WireDispatchOptions,
): Promise<ChannelDispatchResult> {
  const inboundId = params.deliveryIdentity?.trim();
  if (params.requireDeliveryIdentity && !inboundId) {
    throw new Error(`Stable delivery identity is required for ${params.channel}`);
  }
  const observe = (kind: "delivered" | "ambiguous" | "retryable", runId?: string) => {
    emitDeliveryTelemetry({ event: kind === "retryable" ? "retry" : "settlement", channel: params.channel,
      ...(kind === "retryable" ? {} : { outcome: kind }), runId,
      messageId: params.unified?.messageId, deliveryId: inboundId });
  };
  if (!inboundId) {
    const result = await dispatchChannelMessageCore(params, wireOptions);
    if (result.deliveryOutcome?.kind === "delivered" || result.deliveryOutcome?.kind === "ambiguous" ||
        result.deliveryOutcome?.kind === "retryable") observe(result.deliveryOutcome.kind, "runId" in result ? result.runId : undefined);
    return result;
  }

  const stateDir = resolveOpenClawStateDir();
  const journal = createDeliveryJournal(stateDir);
  const identity = [params.channel, params.accountId, inboundId] as const;
  const confirmPrepared = (outcome: "delivered" | "no-reply", runId?: string) => {
    let confirmed = false;
    return () => {
      if (confirmed) return;
      const confirmation = createDeliveryJournal(stateDir);
      try {
        confirmation.confirmPreparedSettlement(...identity, outcome);
        confirmed = true;
        if (outcome === "delivered") observe("delivered", runId);
      } finally {
        confirmation.close();
      }
    };
  };
  try {
    const claim = journal.claim(...identity, fingerprintInbound(params));
    if (claim === "pending") {
      throw new PendingDeliveryReconciliationError(params.channel, params.accountId, inboundId);
    }
    if (claim === "delivered" || claim === "no-reply" || claim === "ack-pending-delivered" || claim === "ack-pending-no-reply") {
      const outcome = claim === "ack-pending-delivered" ? "delivered" : claim === "ack-pending-no-reply" ? "no-reply" : claim;
      const deliveryOutcome = { kind: outcome } as const;
      return { mode: "reply-pipeline", wireResult: { ctx: { skippedDuplicate: true }, dispatcher: undefined,
        replyOptions: {}, deliveryOutcome }, deliveryOutcome,
      // Recovery has no persisted run ID; avoid inventing a run correlation.
      ...(claim.startsWith("ack-pending-") ? { confirmDelivery: confirmPrepared(outcome) } : {}) };
    }

    const deliver = params.reply.deliver;
    let sendAttempted = false;
    let sendsStarted = 0;
    let sendsConfirmed = 0;
    const guarded: ChannelDispatchParams = { ...params, reply: { ...params.reply, deliver: async (payload) => {
      const hash = createHash("sha256").update(payload.wire).digest("hex");
      journal.sendStarted(...identity, hash);
      sendAttempted = true;
      sendsStarted++;
      emitDeliveryTelemetry({ event: "started", channel: params.channel,
        messageId: params.unified?.messageId, deliveryId: inboundId });
      await deliver(payload);
      journal.sendConfirmed(...identity, hash);
      sendsConfirmed++;
    } } };
    let agentStarted = false;
    const beforeAgentDispatch = () => {
      journal.markAgentStarted(...identity);
      agentStarted = true;
    };
    try {
      const result = await dispatchChannelMessageCore(guarded, wireOptions, beforeAgentDispatch);
      if ((result.deliveryOutcome.kind === "delivered" && (sendsConfirmed === 0 || sendsConfirmed !== sendsStarted)) ||
          ((agentStarted || sendAttempted) &&
            (result.deliveryOutcome.kind === "retryable" || result.deliveryOutcome.kind === "cancelled" ||
              (result.deliveryOutcome.kind === "no-reply" && sendsConfirmed !== sendsStarted)))) {
        // The Agent may have changed state. A broker retry would rerun the turn,
        // while the journal deliberately prevents that replay after restart.
        const deliveryOutcome = { kind: "ambiguous" } as const;
        observe("ambiguous", "runId" in result ? result.runId : undefined);
        return result.mode === "reply-pipeline"
          ? { ...result, wireResult: { ...result.wireResult, deliveryOutcome }, deliveryOutcome }
          : { ...result, deliveryOutcome };
      }
      if (result.deliveryOutcome.kind === "delivered" || result.deliveryOutcome.kind === "no-reply") {
        if (params.deferDeliverySettlement) {
          const outcome = result.deliveryOutcome.kind;
          if (params.canPrepareDeliverySettlement?.(outcome) !== true) {
            throw new Error("Broker adapter did not confirm the delivery outcome before ACK preparation");
          }
          // SQLite commits the recovery disposition before the broker ACK frame is sent.
          journal.prepareSettlement(...identity, outcome);
          return { ...result, confirmDelivery: confirmPrepared(outcome, "runId" in result ? result.runId : undefined) };
        }
        journal.settle(...identity, result.deliveryOutcome.kind);
        if (result.deliveryOutcome.kind === "delivered") observe("delivered", "runId" in result ? result.runId : undefined);
      } else if (!agentStarted && !sendAttempted) {
        journal.releaseBeforeSend(...identity);
      }
      if (result.deliveryOutcome.kind === "ambiguous" || result.deliveryOutcome.kind === "retryable") {
        observe(result.deliveryOutcome.kind, "runId" in result ? result.runId : undefined);
      }
      return result;
    } catch (error) {
      if (!agentStarted && !sendAttempted) journal.releaseBeforeSend(...identity);
      if (agentStarted || sendAttempted) throw new PendingDeliveryReconciliationError(params.channel, params.accountId, inboundId, error);
      throw error;
    }
  } finally {
    journal.close();
  }
}

async function dispatchChannelMessageCore(
  params: ChannelDispatchParams,
  wireOptions?: WireDispatchOptions,
  beforeAgentDispatch?: () => void,
): Promise<ChannelDispatchResult> {
  const mode: ChannelDispatchMode = params.mode ?? "reply-pipeline";
  const runtime = params.runtime as BridgePluginRuntime;

  const { agentId, sessionKey } = await resolveChannelDispatchIdentity(runtime, {
    channel: params.channel,
    accountId: params.accountId,
    peerId: params.peerId,
    chatType: params.chatType,
    agentId: params.agentId,
    sessionKey: params.sessionKey,
  });

  // Embedded/subagent 需要更强 Runtime；普通 MQ 插件仍可传入最小 BridgePluginRuntime
  if (mode === "embedded-agent") {
    const agentRuntime = params.runtime as unknown as EmbeddedAgentRuntime;
    const result = await dispatchEmbeddedAgentMessage({
      runtime: agentRuntime,
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
      text: params.text,
      agentId,
      sessionKey,
      sessionId: params.sessionId,
      timeoutMs: params.timeoutMs,
      reply: params.reply,
      beforeAgentDispatch,
    });
    return { mode, ...result, deliveryOutcome: {
      kind: result.outcome === "visible" && result.delivered ? "delivered"
        : result.outcome === "silent" || result.outcome === "empty" ? "no-reply" : "ambiguous",
    } };
  }

  if (mode === "subagent") {
    const subRuntime = params.runtime as unknown as SubagentRuntime;
    const result = await dispatchSubagentMessage({
      runtime: subRuntime,
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
      text: params.text,
      agentId,
      sessionKey,
      childSessionKey: params.childSessionKey,
      timeoutMs: params.timeoutMs,
      replyEnabled: params.replyEnabled,
      reply: params.reply,
      beforeAgentDispatch,
    });
    return { mode, ...result, deliveryOutcome: {
      kind: params.replyEnabled === false ? "no-reply"
        : result.outcome.kind === "visible" && result.delivered ? "delivered"
        : result.outcome.kind === "silent" || result.outcome.kind === "empty" ? "no-reply"
          : result.outcome.kind === "pending" ? "ambiguous" : "retryable",
    } };
  }

  // 默认 reply-pipeline：保留 MQ wire envelope 契约，回复经 deliver 发布到原协议
  const wireResult = await dispatchWireMessage(
    {
      runtime,
      channel: params.channel,
      accountId: params.accountId,
      peerId: params.peerId,
      text: params.text,
      chatType: params.chatType,
      agentId,
      unified: params.unified,
      extra: params.extra,
      reply: {
        deliver: params.reply.deliver,
        outboundFormat: params.reply.outboundFormat,
        structuredMediaHosts: params.reply.structuredMediaHosts,
        deliveryIdentity: params.deliveryIdentity,
        replyRoute: params.reply.replyRoute,
        agentId: params.reply.agentId ?? agentId,
        sessionKey: params.reply.sessionKey ?? sessionKey,
      },
      beforeAgentDispatch,
    },
    wireOptions,
  );

  return { mode: "reply-pipeline", wireResult, deliveryOutcome: wireResult.deliveryOutcome };
}

/** 重新导出 channel dispatch 核心类型 / Re-export channel dispatch types */
export type { ChannelDispatchMode, ChannelDispatchParams, ChannelDispatchResult };

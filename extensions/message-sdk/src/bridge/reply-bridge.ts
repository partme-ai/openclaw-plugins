/**
 * @module bridge/reply-bridge
 *
 * 出站桥接：Agent deliver → serializeForTransport → 传输层回调。
 *
 * **职责**：创建 OpenClaw 回复分发器，在 deliver 时统一序列化为 envelope/legacy/plain wire 字符串。
 *
 * **关键导出**：`createReplyHandler`
 */

import { serializeForTransport } from "../pipeline/serialize-payload.js";
import type { ReplyBridgeParams, ReplyBridgeResult } from "./types.js";
import {
  buildCanonicalSentMessageHookContext,
  fireAndForgetHook,
  toPluginMessageContext,
  toPluginMessageSentEvent,
} from "openclaw/plugin-sdk/hook-runtime";
import { getGlobalHookRunner } from "openclaw/plugin-sdk/plugin-runtime";

/** 重新导出 ReplyBridgeResult / Re-export result type */
export type { ReplyBridgeResult } from "./types.js";

/**
 * 在机器通道完成真实传输后补齐 OpenClaw 的 `message_sent` 生命周期事件。
 *
 * `createReplyDispatcherWithTyping` 只负责驱动插件提供的 deliver 回调；MQTT、RabbitMQ、
 * Redis Stream 等自定义回复路径不会再经过宿主的公共 outbound delivery，因此宿主也不会
 * 自动广播 `message_sent`。这里在传输成功或失败已经确定后统一发出官方 Hook，使 Bridge、
 * Tracing、审计插件看到的事件语义与 Telegram/Slack 等内置通道一致。
 *
 * Hook 观察者失败不能反向改变已经完成的协议投递，所以沿用 OpenClaw 内置通道的
 * fire-and-forget 策略；真实 deliver 错误仍由调用方收到并决定 ACK/重试。
 */
function emitMessageSent(params: {
  channel: string;
  accountId: string;
  peerId: string;
  sessionKey?: string;
  content: string;
  success: boolean;
  error?: string;
}): void {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("message_sent")) return;

  const canonical = buildCanonicalSentMessageHookContext({
    to: params.peerId,
    content: params.content,
    success: params.success,
    error: params.error,
    channelId: params.channel,
    accountId: params.accountId,
    conversationId: params.peerId,
    sessionKey: params.sessionKey,
  });
  fireAndForgetHook(
    Promise.resolve(
      hookRunner.runMessageSent(
        toPluginMessageSentEvent(canonical),
        toPluginMessageContext(canonical),
      ),
    ),
    `${params.channel}: message_sent plugin hook failed`,
  );
}

/**
 * 创建 OpenClaw 回复分发器，出站时统一序列化载荷 / Create reply dispatcher with wire serialization.
 *
 * @param params - Runtime、通道身份、deliver 回调、outboundFormat、replyRoute
 * @returns dispatcher 与 replyOptions（供 dispatchReplyFromConfig 使用）
 */
export function createReplyHandler(params: ReplyBridgeParams): ReplyBridgeResult {
  const {
    runtime,
    channel,
    accountId,
    peerId,
    sessionKey,
    deliver,
    outboundFormat,
    replyRoute,
    agentId,
  } = params;

  const created = runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload: { text: string }) => {
      const wire = serializeForTransport({
        channel,
        accountId,
        userId: peerId,
        text: payload.text,
        agentId,
        format: outboundFormat ?? "envelope",
        replyRoute,
      });
      try {
        await deliver({ text: payload.text, wire });
        emitMessageSent({
          channel,
          accountId,
          peerId,
          sessionKey,
          content: payload.text,
          success: true,
        });
      } catch (error) {
        emitMessageSent({
          channel,
          accountId,
          peerId,
          sessionKey,
          content: payload.text,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  });

  // OpenClaw 2026.7.1 returns a bundle. Older compatible runtimes returned the
  // dispatcher directly, so retain a narrow fallback for already deployed hosts.
  const bundle = created as {
    dispatcher?: unknown;
    replyOptions?: Record<string, unknown>;
  };
  const dispatcher = bundle?.dispatcher ?? created;

  return {
    dispatcher,
    replyOptions: bundle?.dispatcher ? (bundle.replyOptions ?? {}) : {},
  };
}

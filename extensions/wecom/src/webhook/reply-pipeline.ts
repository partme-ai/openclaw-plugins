/**
 * WeCom Webhook 回复管线（OpenClaw SDK + 企微 outbound 适配）。
 */

import type {
  GetReplyOptions,
  OpenClawConfig,
  ReplyDispatcherWithTypingOptions,
  ReplyPayload,
} from "../runtime-api.js";
import {
  createChannelMessageReplyPipeline,
  createReplyPrefixContext,
  createTypingLifecycleHooks,
} from "../runtime-api.js";
import { getWeComRuntime } from "../runtime.js";
import type { WecomWebhookTarget } from "./types.js";
import { deliverWecomReply } from "../outbound/reply-deliver.js";

export type CreateWecomReplyDispatcherParams = {
  target: WecomWebhookTarget;
  streamId: string;
  chatType: string;
  rawBody: string;
  tableMode: Parameters<
    import("../runtime-api.js").PluginRuntime["channel"]["text"]["convertMarkdownTables"]
  >[1];
  cfg: OpenClawConfig;
  agentId: string;
};

export type WecomReplyDispatchBundle = {
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions: Omit<GetReplyOptions, "onBlockReply"> & { disableBlockStreaming: boolean };
};

/**
 * 创建 WeCom Webhook 回复分发器。
 */
export function createWecomReplyDispatcher(
  params: CreateWecomReplyDispatcherParams,
): WecomReplyDispatchBundle {
  const core = getWeComRuntime();
  const { target, streamId, chatType, rawBody, tableMode, cfg, agentId } = params;

  const prefixContext = createReplyPrefixContext({ cfg, agentId });
  const { typingCallbacks } = createChannelMessageReplyPipeline({
    cfg,
    agentId,
    channel: "wecom",
    accountId: target.account.accountId,
  });

  const lifecycle = createTypingLifecycleHooks({
    onTypingIdle: typingCallbacks?.onIdle,
    onCleanup: typingCallbacks?.onCleanup,
    onError: async (err) => {
      target.runtime.error?.(
        `[webhook] Agent reply failed (streamId=${streamId}): ${String(err)}`,
      );
    },
  });

  return {
    dispatcherOptions: {
      responsePrefix: prefixContext.responsePrefix,
      responsePrefixContextProvider: prefixContext.responsePrefixContextProvider,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: async () => {
        await typingCallbacks?.onReplyStart?.();
      },
      deliver: async (payload: ReplyPayload, info) => {
        await deliverWecomReply({
          payload,
          info,
          target,
          streamId,
          chatType,
          rawBody,
          tableMode,
        });
      },
      onError: lifecycle.onError,
      onIdle: lifecycle.onIdle,
      onCleanup: lifecycle.onCleanup,
    },
    replyOptions: {
      onModelSelected: prefixContext.onModelSelected,
      disableBlockStreaming: false,
    },
  };
}

/** @deprecated 使用 createWecomReplyDispatcher */
export const createWecomReplyPipeline = createWecomReplyDispatcher;

/**
 * Wire 路径 dispatch facade：thin wrapper over bridge.dispatchInbound。
 */

import {
  dispatchInbound,
  type DispatchInboundParams,
  type DispatchInboundResult,
} from "../bridge/inbound-bridge.js";
import { InboundMessageStack } from "../stack/inbound-stack.js";
import type { WireDispatchConfig } from "./types.js";

export interface CreateWireDispatchOptions {
  /** 可选配置；当前仅声明 channelClass=wire，行为与 dispatchInbound 一致。 */
  config?: WireDispatchConfig;
  /** 启用入站栈（默认 false，保持 MQ 直派兼容）。 */
  useInboundStack?: boolean;
  /** 自定义栈实例；未提供时在 useInboundStack=true 时创建临时栈。 */
  inboundStack?: InboundMessageStack;
}

/**
 * Wire 路径入站派发（MQ 插件标准入口）。
 * 行为等同 {@link dispatchInbound}；可选经 InboundMessageStack 入栈（默认关闭）。
 */
export async function createWireDispatch(
  params: DispatchInboundParams,
  options?: CreateWireDispatchOptions,
): Promise<DispatchInboundResult> {
  if (!options?.useInboundStack) {
    return dispatchInbound(params);
  }

  let dispatchResult: DispatchInboundResult | undefined;
  const stack =
    options.inboundStack ??
    new InboundMessageStack({
      onPush: async () => {
        dispatchResult = await dispatchInbound(params);
      },
    });

  if (params.unified) {
    const key =
      params.unified.messageId ||
      (typeof params.extra?.messageId === "string" ? params.extra.messageId : undefined);
    const accepted = await stack.push({
      message: params.unified,
      idempotencyKey: key,
      transportMeta: params.extra,
    });
    if (!accepted) {
      return {
        ctx: { skippedDuplicate: true },
        dispatcher: undefined,
        replyOptions: {},
      } as DispatchInboundResult;
    }
    return (
      dispatchResult ??
      ({
        ctx: {},
        dispatcher: undefined,
        replyOptions: {},
      } as DispatchInboundResult)
    );
  }

  return dispatchInbound(params);
}

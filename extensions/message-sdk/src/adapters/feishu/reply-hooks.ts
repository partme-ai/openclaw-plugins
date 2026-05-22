/**
 * Feishu 高级回复 hooks 示例（Transcript 路径；不替代 research 树完整实现）。
 */

import type { IngressPolicyContext, IngressPolicyHook } from "../../ingress/policy.js";
import { runIngressPolicyChain } from "../../ingress/policy.js";
import {
  preprocessOutboundReply,
  type PreprocessOutboundReplyParams,
} from "../../reply/create-dispatcher.js";
import { createReplyDispatcherBundle, type CreateReplyDispatcherBundleParams } from "../../reply/bundle.js";

export type FeishuReplyHooksConfig = {
  ingressPolicy?: IngressPolicyHook[];
  preprocess?: Partial<PreprocessOutboundReplyParams>;
};

/**
 * 创建 Feishu 风格回复 bundle：SDK 通用 preprocess + 渠道 deliver。
 */
export function createFeishuStyleReplyBundle(
  params: CreateReplyDispatcherBundleParams & {
    hooks?: FeishuReplyHooksConfig;
  },
) {
  const { hooks, deliver, ...rest } = params;
  const innerDeliver = deliver;

  return createReplyDispatcherBundle({
    ...rest,
    deliver: async (payload, info) => {
      if (hooks?.preprocess) {
        await preprocessOutboundReply({
          payload,
          ...hooks.preprocess,
        });
      }
      await innerDeliver(payload, info);
    },
  });
}

/**
 * 入站 policy 决策（可注入 allowlist / pairing）。
 */
export async function evaluateFeishuIngressPolicy(
  ctx: IngressPolicyContext,
  hooks: IngressPolicyHook[] = [],
) {
  return runIngressPolicyChain(ctx, { hooks, defaultDecision: "allow" });
}

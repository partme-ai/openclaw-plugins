/**
 * 入站 policy hooks（对齐 Feishu channel-ingress-runtime 的可复用子集）。
 */

export type IngressPolicyDecision = "allow" | "deny" | "pairing";

/**
 * IngressPolicyContext 是 ingress 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type IngressPolicyContext = {
  channel: string;
  accountId: string;
  peerId: string;
  chatType?: "dm" | "group" | "channel";
  rawIdentity?: string;
};

/**
 * IngressPolicyHook 是 ingress 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type IngressPolicyHook = (
  ctx: IngressPolicyContext,
) => IngressPolicyDecision | Promise<IngressPolicyDecision>;

/**
 * IngressPolicyChainOptions 是 ingress 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type IngressPolicyChainOptions = {
  hooks: IngressPolicyHook[];
  /** 默认 allow */
  defaultDecision?: IngressPolicyDecision;
};

/**
 * 顺序执行 policy hooks；首个非 allow 决策生效。
 */
export async function runIngressPolicyChain(
  ctx: IngressPolicyContext,
  options: IngressPolicyChainOptions,
): Promise<IngressPolicyDecision> {
  const fallback = options.defaultDecision ?? "allow";
  for (const hook of options.hooks) {
    const decision = await hook(ctx);
    if (decision !== "allow") {
      return decision;
    }
  }
  return fallback;
}

/**
 * 基于 allowlist 集合的 DM policy hook 工厂。
 */
export function createAllowlistIngressHook(allowlist: Set<string>): IngressPolicyHook {
  return (ctx) => {
    if (allowlist.has("*")) return "allow";
    const id = ctx.rawIdentity?.trim() ?? ctx.peerId.trim();
    if (!id) return "deny";
    return allowlist.has(id) ? "allow" : "deny";
  };
}

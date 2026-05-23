/**
 * @module ingress/policy
 *
 * 入站 policy hooks 链式编排（对齐 Feishu channel-ingress-runtime 可复用子集）。
 *
 * **职责**：提供可组合的 `IngressPolicyHook`，按顺序执行直至首个非 allow 决策；
 * 内置 `createAllowlistIngressHook` 工厂用于 DM allowlist 场景。
 *
 * **适用场景**：通道插件需要在统一 DM/group 策略之外追加自定义准入逻辑（如租户隔离）。
 *
 * **上下游**：
 * - 上游：插件注册的 hook 列表
 * - 下游：allow / deny / pairing 决策驱动是否继续 normalize + dispatch
 *
 * **关键导出**：`runIngressPolicyChain`、`createAllowlistIngressHook`、`IngressPolicyContext`
 */

/** 入站策略决策：放行 / 拒绝 / 需配对 */
export type IngressPolicyDecision = "allow" | "deny" | "pairing";

/**
 * 入站策略 hook 上下文。
 *
 * 由各渠道 adapter 在 normalize 前填充，供 hook 做身份与租户判定。
 */
export type IngressPolicyContext = {
  /** 渠道标识 */
  channel: string;
  /** 账号 ID */
  accountId: string;
  /** 对端 ID（userId 或 chatId） */
  peerId: string;
  /** 会话类型 */
  chatType?: "dm" | "group" | "channel";
  /** 原始身份字符串（如 open_id），优先于 peerId 做 allowlist 匹配 */
  rawIdentity?: string;
};

/**
 * 入站策略 hook 函数签名。
 *
 * 返回 `allow` 时链继续；返回 `deny` / `pairing` 时链立即终止。
 */
export type IngressPolicyHook = (
  ctx: IngressPolicyContext,
) => IngressPolicyDecision | Promise<IngressPolicyDecision>;

/**
 * 策略链执行选项。
 */
export type IngressPolicyChainOptions = {
  /** 按顺序执行的 hook 列表 */
  hooks: IngressPolicyHook[];
  /** 全部 hook 返回 allow 时的默认决策，默认 `allow` */
  defaultDecision?: IngressPolicyDecision;
};

/**
 * 顺序执行 policy hooks；首个非 allow 决策生效。
 *
 * 采用短路语义：一旦某 hook 返回 deny/pairing，后续 hook 不再执行。
 *
 * @param ctx - 入站上下文
 * @param options - 链配置（hooks + 默认决策）
 * @returns 最终策略决策
 *
 * @example
 * ```ts
 * const decision = await runIngressPolicyChain(ctx, {
 *   hooks: [createAllowlistIngressHook(allowSet)],
 *   defaultDecision: "allow",
 * });
 * if (decision !== "allow") return;
 * ```
 */
export async function runIngressPolicyChain(
  ctx: IngressPolicyContext,
  options: IngressPolicyChainOptions,
): Promise<IngressPolicyDecision> {
  const fallback = options.defaultDecision ?? "allow";
  for (const hook of options.hooks) {
    const decision = await hook(ctx);
    // 短路：首个非 allow 即终止链
    if (decision !== "allow") {
      return decision;
    }
  }
  return fallback;
}

/**
 * 基于 allowlist 集合的 DM policy hook 工厂。
 *
 * @param allowlist - 允许的身份 ID 集合；含 `"*"` 时放行全部
 * @returns 可用于 {@link runIngressPolicyChain} 的 hook 函数
 *
 * @example
 * ```ts
 * const hook = createAllowlistIngressHook(new Set(["user1", "user2"]));
 * ```
 */
export function createAllowlistIngressHook(allowlist: Set<string>): IngressPolicyHook {
  return (ctx) => {
    if (allowlist.has("*")) return "allow";
    const id = ctx.rawIdentity?.trim() ?? ctx.peerId.trim();
    if (!id) return "deny";
    return allowlist.has(id) ? "allow" : "deny";
  };
}

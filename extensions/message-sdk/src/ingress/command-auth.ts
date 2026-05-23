/**
 * @module ingress/command-auth
 *
 * 通道无关的命令授权解析。
 *
 * **职责**：归一化 allowFrom、判断发送者是否在白名单，并调用 OpenClaw
 * `shouldComputeCommandAuthorized` / `resolveCommandAuthorizedFromAuthorizers` 得出
 * `commandAuthorized` 结论。
 *
 * **适用场景**：用户消息含 slash command 或内置指令时，在 dispatch 前决定是否允许执行。
 *
 * **上下游**：
 * - 上游：账号级 `dmPolicy` + `allowFrom` 配置
 * - 下游：OpenClaw PluginRuntime.channel.commands
 *
 * **关键导出**：`resolveCommandAuthorization`、`createAllowFromNormalizer`、`isSenderInAllowFrom`
 */

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";

/** 私信策略 */
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

/** 账号级命令授权配置 */
export interface CommandAuthAccountConfig {
  /** DM 策略；影响 effectiveAllowFrom 推导 */
  dmPolicy?: DmPolicy;
  /** 发送者白名单 */
  allowFrom?: Array<string | number>;
}

/** 命令授权解析结果 */
export interface CommandAuthResult {
  /** 当前消息是否需要计算 command 授权 */
  shouldComputeAuth: boolean;
  /** 生效的 DM 策略 */
  dmPolicy: DmPolicy;
  /** 发送者是否在白名单内 */
  senderAllowed: boolean;
  /** 是否已配置 authorizer（allowFrom 非空或含 *） */
  authorizerConfigured: boolean;
  /** 最终 command 授权结论；不需计算时为 undefined */
  commandAuthorized: boolean | undefined;
  /** 合并后的有效 allowFrom 列表 */
  effectiveAllowFrom: string[];
}

/** allowFrom 归一化器配置 */
export interface CreateAllowFromNormalizerOptions {
  /** 渠道 ID，会剥离 `{channelId}:` 前缀（如 wecom:） */
  channelId?: string;
  /** 额外剥离的前缀（如 user:、userid:） */
  stripPrefixes?: string[];
}

/**
 * 创建 allowFrom 条目归一化函数：去空格、小写、剥离渠道/用户前缀。
 *
 * @param options - 归一化选项
 * @returns `(raw: string) => string` 归一化函数
 *
 * @example
 * ```ts
 * const normalize = createAllowFromNormalizer({ channelId: "wecom", stripPrefixes: ["user:"] });
 * normalize("wecom:User:abc"); // => "abc"
 * ```
 */
export function createAllowFromNormalizer(
  options: CreateAllowFromNormalizerOptions,
): (raw: string) => string {
  const prefixes: string[] = [];
  if (options.channelId) {
    prefixes.push(`${options.channelId.toLowerCase()}:`);
  }
  for (const prefix of options.stripPrefixes ?? []) {
    prefixes.push(prefix.toLowerCase());
  }

  return (raw: string) => {
    let value = raw.trim().toLowerCase();
    for (const prefix of prefixes) {
      if (value.startsWith(prefix)) {
        value = value.slice(prefix.length);
      }
    }
    return value;
  };
}

/**
 * 判断发送者是否在 allowFrom 白名单中。
 *
 * @param senderUserId - 发送者用户 ID
 * @param allowFrom - 白名单原始条目
 * @param normalizeAllowFrom - 条目归一化函数
 * @returns 是否允许
 */
export function isSenderInAllowFrom(
  senderUserId: string,
  allowFrom: string[],
  normalizeAllowFrom: (raw: string) => string,
): boolean {
  const list = allowFrom.map((entry) => normalizeAllowFrom(entry)).filter(Boolean);
  if (list.includes("*")) return true;
  const normalizedSender = normalizeAllowFrom(senderUserId);
  if (!normalizedSender) return false;
  return list.includes(normalizedSender);
}

/**
 * 解析命令授权状态（OpenClaw shouldCompute + resolveCommandAuthorizedFromAuthorizers）。
 *
 * dmPolicy=open 时 effectiveAllowFrom 视为 `["*"]`，即不限制 command 执行身份。
 *
 * @param params.core - OpenClaw PluginRuntime
 * @param params.cfg - OpenClaw 全局配置
 * @param params.accountConfig - 账号级 DM/allowFrom 配置
 * @param params.rawBody - 用户原始消息正文
 * @param params.senderUserId - 发送者 ID
 * @param params.normalizeAllowFrom - allowFrom 归一化函数
 * @returns 命令授权解析结果
 */
export async function resolveCommandAuthorization(params: {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  accountConfig: CommandAuthAccountConfig;
  rawBody: string;
  senderUserId: string;
  normalizeAllowFrom: (raw: string) => string;
}): Promise<CommandAuthResult> {
  const { core, cfg, accountConfig, rawBody, senderUserId, normalizeAllowFrom } = params;

  const dmPolicy = (accountConfig.dmPolicy ?? "pairing") as DmPolicy;
  const configAllowFrom = (accountConfig.allowFrom ?? []).map((v) => String(v));

  const shouldComputeAuth = core.channel.commands.shouldComputeCommandAuthorized(rawBody, cfg);
  // open 策略：命令授权不依赖 allowFrom，等效全员 *
  const effectiveAllowFrom = dmPolicy === "open" ? ["*"] : configAllowFrom;

  const senderAllowed = isSenderInAllowFrom(senderUserId, effectiveAllowFrom, normalizeAllowFrom);
  const allowAllConfigured = effectiveAllowFrom.some(
    (entry) => normalizeAllowFrom(entry) === "*",
  );
  const authorizerConfigured = allowAllConfigured || effectiveAllowFrom.length > 0;
  const useAccessGroups = cfg.commands?.useAccessGroups !== false;

  const commandAuthorized = shouldComputeAuth
    ? core.channel.commands.resolveCommandAuthorizedFromAuthorizers({
        useAccessGroups,
        authorizers: [{ configured: authorizerConfigured, allowed: senderAllowed }],
      })
    : undefined;

  return {
    shouldComputeAuth,
    dmPolicy,
    senderAllowed,
    authorizerConfigured,
    commandAuthorized,
    effectiveAllowFrom,
  };
}

/**
 * WeCom KF 命令授权薄封装（shared/command-auth）
 *
 * 职责：将账号 `dm.policy` + `dm.allowFrom` 映射到 message-sdk 通用入站授权流程。
 *
 * 与 @partme.ai/openclaw-message-sdk 的关系：
 * - `resolveCommandAuthorization` 来自 message-sdk/ingress（channelId=wecom-kf）
 * - 未授权时的中文提示由本模块 `buildWecomUnauthorizedCommandPrompt` 提供
 */
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk";
import {
  createAllowFromNormalizer,
  resolveCommandAuthorization,
  type CommandAuthAccountConfig,
  type CommandAuthResult,
} from "@partme.ai/openclaw-message-sdk/ingress";

import type { WecomAgentConfig, WecomBotConfig } from "../types/index.js";

/** Bot 或 Agent 子配置中参与命令鉴权的字段子集（嵌套 dm 结构） */
type WecomCommandAuthAccountConfig =
  | Pick<WecomBotConfig, "dm">
  | Pick<WecomAgentConfig, "dm">;

/** wecom-kf 通道 allowFrom 归一化：剥离 wecom-kf / wecom-cs / user 前缀 */
const normalizeWecomKfAllowFrom = createAllowFromNormalizer({
  channelId: "wecom-kf",
  stripPrefixes: ["wecom-cs:", "user:", "userid:"],
});

export type WecomCommandAuthResult = CommandAuthResult;

/**
 * 将嵌套 `dm` 配置映射为 message-sdk 扁平 `CommandAuthAccountConfig`。
 */
function toCommandAuthAccountConfig(
  accountConfig: WecomCommandAuthAccountConfig,
): CommandAuthAccountConfig {
  return {
    dmPolicy: accountConfig.dm?.policy,
    allowFrom: accountConfig.dm?.allowFrom,
  };
}

/**
 * 解析 WeCom KF / CS 命令授权状态（委托 message-sdk）。
 */
export async function resolveWecomCommandAuthorization(params: {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  accountConfig: WecomCommandAuthAccountConfig;
  rawBody: string;
  senderUserId: string;
}): Promise<WecomCommandAuthResult> {
  return resolveCommandAuthorization({
    core: params.core,
    cfg: params.cfg,
    accountConfig: toCommandAuthAccountConfig(params.accountConfig),
    rawBody: params.rawBody,
    senderUserId: params.senderUserId,
    normalizeAllowFrom: normalizeWecomKfAllowFrom,
  });
}

/**
 * 构建未授权命令的中文提示文案。
 */
export function buildWecomUnauthorizedCommandPrompt(params: {
  senderUserId: string;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  scope: "bot" | "agent" | "kf";
}): string {
  const user = params.senderUserId || "unknown";
  const policy = params.dmPolicy;
  const scopeLabel =
    params.scope === "bot"
      ? "Bot（智能机器人）"
      : params.scope === "kf"
        ? "KF（微信客服）"
        : "Agent（自建应用）";
  const dmPrefix =
    params.scope === "bot"
      ? "channels.wecom-cs.bot.dm"
      : params.scope === "kf"
        ? "channels.wecom-cs.accounts.<accountId>.agent.dm"
        : "channels.wecom-cs.agent.dm";
  const allowCmd = (value: string) => `openclaw config set ${dmPrefix}.allowFrom '${value}'`;
  const policyCmd = (value: string) => `openclaw config set ${dmPrefix}.policy "${value}"`;

  if (policy === "disabled") {
    return [
      `无权限执行命令（${scopeLabel} 已禁用：dm.policy=disabled）`,
      `触发者：${user}`,
      `管理员：${policyCmd("open")}（全放开）或 ${policyCmd("allowlist")}（白名单）`,
    ].join("\n");
  }

  return [
    `无权限执行命令（入口：${scopeLabel}，userid：${user}）`,
    `管理员全放开：${policyCmd("open")}`,
    `管理员放行该用户：${policyCmd("allowlist")}`,
    `然后设置白名单：${allowCmd(JSON.stringify([user]))}`,
    `如果仍被拦截：检查 commands.useAccessGroups/访问组`,
  ].join("\n");
}

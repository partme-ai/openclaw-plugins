/**
 * WeCom 命令授权薄封装（shared/command-auth）
 *
 * 职责：将企微 Bot / Agent 账号的 `dmPolicy` + `allowFrom` 映射到 message-sdk 通用入站授权流程。
 *
 * 与 @partme.ai/openclaw-message-sdk 的关系：
 * - `createAllowFromNormalizer` / `resolveCommandAuthorization` 来自 message-sdk/ingress
 * - 本模块仅注入 WeCom 通道特有规则（channelId=wecom、userid 前缀剥离）
 * - 未授权时的中文提示文案由本模块 `buildWecomUnauthorizedCommandPrompt` 提供（SDK 无通道文案）
 *
 * 调用方：webhook/command-auth、agent 入站管线等需要判断 slash/command 是否允许执行的场景。
 */

import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import {
  createAllowFromNormalizer,
  resolveCommandAuthorization,
  type CommandAuthResult,
} from "@partme.ai/openclaw-message-sdk/ingress";

import type { WecomAgentConfig, WecomBotConfig } from "../types/config.js";

/** Bot 或 Agent 子配置中参与命令鉴权的字段子集 */
type WecomCommandAuthAccountConfig =
  | Pick<WecomBotConfig, "dmPolicy" | "allowFrom">
  | Pick<WecomAgentConfig, "dmPolicy" | "allowFrom">;

/** 企微 allowFrom 条目规范化：剥离 `user:` / `userid:` 前缀后交给 SDK 比对 */
const normalizeWecomAllowFrom = createAllowFromNormalizer({
  channelId: "wecom",
  stripPrefixes: ["user:", "userid:"],
});

/** 与 message-sdk CommandAuthResult 一致，便于上层解构 authorized / reason 等字段 */
export type WecomCommandAuthResult = CommandAuthResult;

/**
 * 解析 WeCom 命令授权状态。
 *
 * 薄封装：直接委托 message-sdk `resolveCommandAuthorization`，仅传入 WeCom 的 allowFrom 规范化器。
 *
 * @param params.core OpenClaw 运行时（配对、访问组等能力）
 * @param params.cfg 全局 OpenClaw 配置
 * @param params.accountConfig 当前 Bot 或 Agent 子配置的 dmPolicy / allowFrom
 * @param params.rawBody 原始消息体（SDK 用于提取命令文本）
 * @param params.senderUserId 发送者企微 userid
 * @returns 授权结果（是否允许、拒绝原因、配对提示等）
 */
export async function resolveWecomCommandAuthorization(params: {
  core: PluginRuntime;
  cfg: OpenClawConfig;
  accountConfig: WecomCommandAuthAccountConfig;
  rawBody: string;
  senderUserId: string;
}): Promise<WecomCommandAuthResult> {
  return resolveCommandAuthorization({
    ...params,
    normalizeAllowFrom: normalizeWecomAllowFrom,
  });
}

/**
 * 构建未授权命令的中文提示文案（WeCom 本地实现，非 message-sdk）。
 *
 * 根据 dmPolicy 与入口（Bot 智能机器人 / Agent 自建应用）生成可复制的 `openclaw config set` 命令，
 * 方便管理员自助放行。
 *
 * @param params.senderUserId 触发命令的用户 userid
 * @param params.dmPolicy 当前 DM 策略
 * @param params.scope 命令入口：`bot` 对应 channels.wecom.bot，`agent` 对应 channels.wecom.agent
 */
export function buildWecomUnauthorizedCommandPrompt(params: {
  senderUserId: string;
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled";
  scope: "bot" | "agent";
}): string {
  const user = params.senderUserId || "unknown";
  const policy = params.dmPolicy;
  const scopeLabel = params.scope === "bot" ? "Bot（智能机器人）" : "Agent（自建应用）";
  const dmPrefix = params.scope === "bot" ? "channels.wecom.bot" : "channels.wecom.agent";
  const allowCmd = (value: string) => `openclaw config set ${dmPrefix}.allowFrom '${value}'`;
  const policyCmd = (value: string) => `openclaw config set ${dmPrefix}.dmPolicy "${value}"`;

  if (policy === "disabled") {
    return [
      `无权限执行命令（${scopeLabel} 已禁用：dmPolicy=disabled）`,
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

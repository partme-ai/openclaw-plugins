/**
 * @file Gotify inbound ingress — DM / pairing / allowlist 运行时裁决。
 *
 * @description 封装 `resolveChannelMessageIngress`，把 Gotify 特有 **peerId ↔ appid**
 * 别名语义映射到 OpenClaw ingress identity；**不负责** OpenClaw UI 侧策略提示——那部分由
 * `createScopedDmSecurityResolver` 在 `channel/channel.ts` 聚合。
 * **模块角色**：Channel Plugin · Inbound security gate。
 */

import {
  defineStableChannelIngressIdentity,
  resolveChannelMessageIngress,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { ResolveChannelMessageIngressParams } from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type { ResolvedGotifyAccount } from "./types.js";

/**
 * 规范化 allowlist / peer 标识令牌。
 *
 * @description 剥离可选 `gotify:` 渠道前缀并 lower-case，统一与 stream extras 中的 peer 别名比对。
 * @param value - allowFrom 列表项、peerId、`appid` stringify 等。
 * @returns 有效非空 token；否则 `null`。
 */
function normalizeGotifyId(value: string): string | null {
  const normalized = value
    .replace(/^gotify:/i, "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

/**
 * Stable ingress identity spec —— 让 allowlist 可同时匹配 **peerId / appid / gotify: 前缀形态**。
 *
 * @description Primary subject 使用路由层 `peerId`；
 * 额外注册 `appid` plug-in kind 别名，映射 Gotify Application 维度身份。
 * wildcard `*` 条目由 `isWildcardEntry` 透传至 SDK open 语义。
 */
export const gotifyIngressIdentity = defineStableChannelIngressIdentity({
  normalize: normalizeGotifyId,
  aliases: [
    {
      key: "appid",
      kind: "plugin:gotify-appid",
      normalizeEntry: normalizeGotifyId,
      normalizeSubject: (value) => normalizeGotifyId(String(value)),
    },
  ],
  isWildcardEntry: (value) => value.trim() === "*",
});

/**
 * 运行时 DM ingress 决策裁剪视图。
 *
 * @description 屏蔽 SDK 完整 `IngressResult`，只暴露 channel 层需要的 `allowed + reason + decision`。
 */
export interface GotifyInboundAccessResult {
  /** 是否允许当前入站消息进入 OpenClaw agent。 */
  allowed: boolean;
  /** 阻断原因码，来自 channel-ingress-runtime。 */
  reason?: string;
  /** 完整决策名称，例如 allowlist、pairing、blocked。 */
  decision?: string;
}

/**
 * 对单条 stream 事件执行 DM / pairing / disabled 组合策略检查。
 *
 * @description 读取 `account.dmPolicy`、`allowFrom`、`cfg.accessGroups`，并注入 `appid` 别名维度；
 * pairing store 采用 SDK 默认路径。
 *
 * @param params - 入站裁决上下文。
 * @param params.cfg - OpenClaw 聚合配置（accessGroups / pairing）。
 * @param params.account - 解析后的账号运行时视图。
 * @param params.peerId - `peer-resolver` 产出稳定 direct peer。
 * @param params.appid - stream envelope `appid`，可为 number/string/null。
 * @returns `{ allowed, reason?, decision? }`。
 */
export async function checkGotifyInboundAccess(params: {
  cfg: OpenClawConfig;
  account: ResolvedGotifyAccount;
  peerId: string;
  appid?: number | string | null;
}): Promise<GotifyInboundAccessResult> {
  const { cfg, account, peerId, appid } = params;
  const cfgRecord = cfg as Record<string, unknown>;

  const ingress = await resolveChannelMessageIngress({
    channelId: "gotify",
    accountId: account.accountId,
    identity: gotifyIngressIdentity,
    subject: {
      stableId: peerId,
      ...(appid !== undefined && appid !== null
        ? { aliases: { appid: String(appid) } }
        : {}),
    },
    conversation: { kind: "direct", id: peerId },
    event: { kind: "message", authMode: "inbound", mayPair: true },
    policy: {
      dmPolicy: account.dmPolicy ?? "open",
      groupPolicy: "disabled",
    },
    allowFrom: account.allowFrom,
    accessGroups: cfgRecord.accessGroups as
      | ResolveChannelMessageIngressParams["accessGroups"]
      | undefined,
    useDefaultPairingStore: true,
  });

  if (ingress.senderAccess.allowed) {
    return { allowed: true, decision: ingress.senderAccess.decision };
  }

  return {
    allowed: false,
    reason: ingress.senderAccess.reasonCode,
    decision: ingress.senderAccess.decision,
  };
}

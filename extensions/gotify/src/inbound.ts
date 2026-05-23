/**
 * Gotify 入站 DM 访问控制 — 使用 OpenClaw channel-ingress-runtime SDK。
 *
 * 配置/UI 层仍由 createScopedDmSecurityResolver（channel.ts security.resolveDmPolicy）负责；
 * 运行时入站过滤统一走 resolveChannelMessageIngress，与 bundled 渠道语义一致。
 */

import {
  defineStableChannelIngressIdentity,
  resolveChannelMessageIngress,
} from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { ResolveChannelMessageIngressParams } from "openclaw/plugin-sdk/channel-ingress-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";

import type { ResolvedGotifyAccount } from "./types.js";

/**
 * 规范化 Gotify allowlist / sender 标识。
 *
 * @param value - allowFrom 条目、peerId 或 appid 字符串。
 * @returns 去除 `gotify:` 前缀并转小写后的标识；空值返回 null。
 */
function normalizeGotifyId(value: string): string | null {
  const normalized = value
    .replace(/^gotify:/i, "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

/**
 * Gotify 入站身份定义。
 *
 * primary identity 使用解析后的 peerId；appid 作为别名注册，使 allowlist 可以同时写
 * `peer-a` 或 `42`。这对 Gotify 很重要，因为 Gotify 本身没有 IM 用户概念，appid
 * 往往就是业务系统或外部应用的稳定身份。
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
 * Gotify 入站访问控制结果。
 *
 * 该结构对外隐藏 channel-ingress-runtime 的完整细节，只保留 channel.ts
 * 处理入站消息时需要的布尔结果、阻断原因和决策名称。
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
 * 检查 Gotify 入站消息是否通过 DM 策略（SDK resolveChannelMessageIngress）。
 *
 * @param params - 入站访问控制上下文。
 * @param params.cfg - OpenClaw 当前完整配置，用于读取 accessGroups 和 pairing store。
 * @param params.account - 已解析 Gotify 账号配置，包含 dmPolicy 与 allowFrom。
 * @param params.peerId - 从 Gotify 消息解析出的稳定对端 ID。
 * @param params.appid - Gotify Application ID，作为 allowlist 别名参与匹配。
 * @returns 是否允许入站，以及阻断时的原因码。
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

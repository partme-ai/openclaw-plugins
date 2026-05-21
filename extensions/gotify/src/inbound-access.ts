/**
 * Gotify 入站 DM 访问控制 — 使用 OpenClaw channel-ingress-runtime SDK。
 *
 * 配置/UI 层仍由 createScopedDmSecurityResolver（channel.ts security.resolveDmPolicy）负责；
 * 运行时入站过滤统一走 resolveChannelMessageIngress，与 bundled 渠道语义一致。
 */

import {
  defineStableChannelIngressIdentity,
  resolveChannelMessageIngress,
} from 'openclaw/plugin-sdk/channel-ingress-runtime';
import type { OpenClawConfig } from 'openclaw/plugin-sdk/core';

import type { ResolvedGotifyAccount } from './types.js';

/** 规范化 Gotify allowlist / sender 标识（小写、去 gotify: 前缀）。 */
function normalizeGotifyId(value: string): string | null {
  const normalized = value.replace(/^gotify:/i, '').trim().toLowerCase();
  return normalized || null;
}

/**
 * Gotify 入站身份：primary = peerId，appid 为别名以便 allowlist 匹配 appid 或 peer。
 */
export const gotifyIngressIdentity = defineStableChannelIngressIdentity({
  normalize: normalizeGotifyId,
  aliases: [
    {
      key: 'appid',
      kind: 'plugin:gotify-appid',
      normalizeEntry: normalizeGotifyId,
      normalizeSubject: (value) => normalizeGotifyId(String(value)),
    },
  ],
  isWildcardEntry: (value) => value.trim() === '*',
});

export interface GotifyInboundAccessResult {
  allowed: boolean;
  reason?: string;
  decision?: string;
}

/**
 * 检查 Gotify 入站消息是否通过 DM 策略（SDK resolveChannelMessageIngress）。
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
    channelId: 'gotify',
    accountId: account.accountId,
    identity: gotifyIngressIdentity,
    subject: {
      stableId: peerId,
      ...(appid !== undefined && appid !== null ? { aliases: { appid: String(appid) } } : {}),
    },
    conversation: { kind: 'direct', id: peerId },
    event: { kind: 'message', authMode: 'inbound', mayPair: true },
    policy: {
      dmPolicy: account.dmPolicy ?? 'open',
      groupPolicy: 'disabled',
    },
    allowFrom: account.allowFrom,
    accessGroups: cfgRecord.accessGroups as
      | Record<string, unknown>
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

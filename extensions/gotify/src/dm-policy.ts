/**
 * Gotify 入站 DM 访问控制 — 按 dmPolicy / allowFrom 过滤 peerId 或 appid。
 */

import type { ResolvedGotifyAccount } from './types.js';

export type GotifyDmPolicy = 'open' | 'allowlist' | 'pairing' | 'disabled';

export interface GotifyInboundDmCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * 规范化 allowFrom 条目（小写、去 gotify: 前缀）。
 */
export function normalizeGotifyAllowFromEntry(raw: string): string {
  return raw.replace(/^gotify:/i, '').trim().toLowerCase();
}

/**
 * 判断 sender 是否在 allowFrom 列表中（支持 "*" 通配符）。
 */
export function isGotifySenderAllowed(
  senderId: string,
  allowFrom: Array<string | number>
): boolean {
  const normalizedSender = normalizeGotifyAllowFromEntry(senderId);
  if (!normalizedSender) {
    return false;
  }
  const list = allowFrom.map((entry) => normalizeGotifyAllowFromEntry(String(entry))).filter(Boolean);
  if (list.includes('*')) {
    return true;
  }
  return list.some((entry) => entry === normalizedSender);
}

/**
 * 检查 Gotify 入站消息是否通过 DM 策略（基于 peerId 与 appid）。
 */
export function checkGotifyInboundDmAccess(params: {
  account: ResolvedGotifyAccount;
  peerId: string;
  appid?: number | string | null;
}): GotifyInboundDmCheckResult {
  const { account, peerId, appid } = params;
  const dmPolicy = account.dmPolicy ?? 'open';
  const configAllowFrom = (account.allowFrom ?? []).map((v) => String(v));

  if (dmPolicy === 'disabled') {
    return { allowed: false, reason: 'dmPolicy=disabled' };
  }

  if (dmPolicy === 'open') {
    return { allowed: true };
  }

  const candidates = [peerId];
  if (appid !== undefined && appid !== null) {
    candidates.push(String(appid));
  }

  const allowed = candidates.some((candidate) =>
    isGotifySenderAllowed(candidate, configAllowFrom)
  );

  if (allowed) {
    return { allowed: true };
  }

  if (dmPolicy === 'pairing') {
    return { allowed: false, reason: 'pairing required' };
  }

  return { allowed: false, reason: `dmPolicy=${dmPolicy}` };
}

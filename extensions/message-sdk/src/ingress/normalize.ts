/**
 * 入站归一化 wrapper（渠道 payload → UnifiedMessage）。
 */

import { gotifyStreamToUnified, type GotifyStreamLike } from "../adapters/gotify.js";
import type { UnifiedMessage } from "../core/types.js";

export interface NormalizeGotifyIngressParams {
  accountId: string;
  peerId: string;
  agentId?: string;
  message: GotifyStreamLike;
}

/**
 * Gotify 入站 wrapper：包装现有 gotifyStreamToUnified，供 ingress/ 统一调用。
 */
export function normalizeGotifyIngress(params: NormalizeGotifyIngressParams): UnifiedMessage {
  return gotifyStreamToUnified(params);
}

/** 当前支持的 ingress normalize 渠道 discriminated union。 */
export type NormalizeIngressParams =
  | {
      channel: "gotify";
      accountId: string;
      peerId: string;
      agentId?: string;
      payload: GotifyStreamLike;
    };

/**
 * 统一 ingress normalize 入口（按 channel 分流至渠道 adapter）。
 */
export function normalizeIngress(params: NormalizeIngressParams): UnifiedMessage {
  if (params.channel === "gotify") {
    return normalizeGotifyIngress({
      accountId: params.accountId,
      peerId: params.peerId,
      agentId: params.agentId,
      message: params.payload,
    });
  }

  throw new Error(`Unsupported channel for normalizeIngress: ${(params as { channel: string }).channel}`);
}

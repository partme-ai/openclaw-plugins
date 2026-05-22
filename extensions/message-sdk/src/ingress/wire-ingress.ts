/**
 * Wire 路径入站 helper：parseTransportPayload + 可选幂等 + UnifiedMessage。
 */

import type { IdempotencyCache } from "../dedup/idempotency-cache.js";
import {
  parseTransportPayload,
  type ParsedTransportPayload,
  type PayloadParseMode,
} from "../pipeline/parse-payload.js";

/**
 * WireIngressParams 是 ingress 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type WireIngressParams = {
  rawPayload: string;
  mode: PayloadParseMode;
  channel: string;
  idempotencyKey?: string;
  idempotency?: IdempotencyCache;
};

/**
 * WireIngressResult 是 ingress 模块的公开类型别名。
 *
 * 该类型用于收窄调用边界，确保不同通道插件复用同一套 SDK 契约。
 */
export type WireIngressResult = ParsedTransportPayload & {
  accepted: boolean;
  duplicate?: boolean;
};

/**
 * 解析传输层载荷；若配置幂等且 key 重复则 accepted=false。
 */
export function normalizeWireIngress(params: WireIngressParams): WireIngressResult {
  const parsed = parseTransportPayload(params.rawPayload, params.mode);

  if (params.idempotency && params.idempotencyKey) {
    const duplicate = params.idempotency.remember(params.idempotencyKey);
    if (duplicate) {
      return { ...parsed, accepted: false, duplicate: true };
    }
  }

  return { ...parsed, accepted: true, duplicate: false };
}

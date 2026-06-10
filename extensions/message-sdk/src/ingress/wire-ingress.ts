/**
 * @module ingress/wire-ingress
 *
 * Wire 路径入站 helper。
 *
 * **职责**：解析传输层原始载荷（`parseTransportPayload`），可选结合
 * `IdempotencyCache` 做重复 key 短路，输出带 `accepted` 标志的结果。
 *
 * **适用场景**：WebSocket / Webhook 等 wire 类通道（`CHANNEL_CLASS_WIRE`）的入站首步。
 *
 * **上下游**：
 * - 上游：渠道 adapter 提供的 rawPayload + idempotencyKey
 * - 下游：`normalizeIngress` 或 `buildMessage` 构建 `UnifiedMessage`
 *
 * **关键导出**：`normalizeWireIngress`、`WireIngressParams`、`WireIngressResult`
 */

import type { IdempotencyCache } from "../dedup/idempotency-cache.js";
import {
  parseTransportPayload,
  type ParsedTransportPayload,
  type PayloadParseMode,
} from "../pipeline/parse-payload.js";

/**
 * Wire 入站归一化参数。
 */
export type WireIngressParams = {
  /** 传输层原始载荷字符串（JSON / XML 等，由 mode 决定解析方式） */
  rawPayload: string;
  /** 载荷解析模式（如 json、xml） */
  mode: PayloadParseMode;
  /** 渠道标识 */
  channel: string;
  /** 幂等键；与 idempotency 同时提供时启用去重 */
  idempotencyKey?: string;
  /** 幂等缓存实例；重复 key 时短路为 duplicate */
  idempotency?: IdempotencyCache;
};

/**
 * Wire 入站归一化结果。
 *
 * 在 {@link ParsedTransportPayload} 基础上附加接受状态。
 */
export type WireIngressResult = ParsedTransportPayload & {
  /** 是否接受处理（duplicate 时为 false） */
  accepted: boolean;
  /** 是否为重复消息（幂等命中） */
  duplicate?: boolean;
};

/**
 * 解析传输层载荷；若配置幂等且 key 重复则 `accepted=false`。
 *
 * @param params - Wire 入站参数，见 {@link WireIngressParams}
 * @returns 解析结果 + 接受/重复标志
 *
 * @example
 * ```ts
 * const result = normalizeWireIngress({
 *   rawPayload: '{"text":"hi"}',
 *   mode: "json",
 *   channel: "wecom",
 *   idempotencyKey: "msg-001",
 *   idempotency: cache,
 * });
 * if (!result.accepted) return; // duplicate
 * ```
 */
export function normalizeWireIngress(params: WireIngressParams): WireIngressResult {
  const parsed = parseTransportPayload(params.rawPayload, params.mode);

  // 幂等短路：同一 idempotencyKey 在 TTL 内重复投递时直接拒绝，避免重复 dispatch
  if (params.idempotency && params.idempotencyKey) {
    const duplicate = params.idempotency.remember(params.idempotencyKey);
    if (duplicate) {
      return { ...parsed, accepted: false, duplicate: true };
    }
  }

  return { ...parsed, accepted: true, duplicate: false };
}

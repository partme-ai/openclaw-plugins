/**
 * @module metadata
 *
 * 通道消息元数据 — 统一存放在 native `extras.openclaw` 字段。
 *
 * **职责**：
 * - 出站回声检测（echo guard）
 * - peer / correlation / trace 标识
 * - 跨通道 reply 路由信息
 *
 * **适用**：Gotify `extras.openclaw`；MQ/Webhook 可在 header 或 JSON envelope 携带相同结构。
 *
 * **关键导出**：`readMetadata`、`mergeMetadata`、`markOutboundMetadata`、`isOutboundEcho`
 */

import type { ReplyRoute } from "../core/types.js";

/** extras 中存放 OpenClaw 元数据的键名 / Key under channel-native extras */
export const METADATA_EXTRAS_KEY = "openclaw";

/** 标记元数据来源为 OpenClaw / Metadata source identifier */
export const METADATA_SOURCE = "openclaw";

/**
 * 消息元数据契约 / Message metadata carried in extras.openclaw.
 *
 * @property source - 来源标识（出站时为 {@link METADATA_SOURCE}）
 * @property outbound - 是否为 SDK 发出的出站消息（用于 echo 过滤）
 * @property peerId - 对端用户/会话 ID
 * @property correlationId - 业务关联 ID（如 webhook 事件 ID）
 * @property traceId - 分布式追踪 ID
 * @property replyRoute - 跨通道回复路由键值对
 */
export interface MessageMetadata {
  source?: string;
  outbound?: boolean;
  peerId?: string;
  correlationId?: string;
  traceId?: string;
  replyRoute?: ReplyRoute;
  [key: string]: unknown;
}

/** 通道 native extras 对象 / Opaque extras record from transport */
export type NativeExtras = Record<string, unknown>;

/**
 * 可携带元数据的输入形态 / Carrier that may hold extras or nested extras.
 */
export type MetadataCarrier =
  | NativeExtras
  | {
      extras?: NativeExtras | null;
    }
  | null
  | undefined;

/**
 * 从 carrier 读取 `extras.openclaw` 元数据。
 *
 * @param input - extras 对象或 `{ extras }` 包装
 * @returns 解析后的元数据；不存在或非 plain object 时返回 `undefined`
 *
 * @example
 * ```ts
 * const meta = readMetadata({ openclaw: { peerId: "u1" } });
 * ```
 */
export function readMetadata(input: MetadataCarrier): MessageMetadata | undefined {
  const extras = resolveExtrasRecord(input);
  const metadata = extras?.[METADATA_EXTRAS_KEY];
  if (!isPlainObject(metadata)) {
    return undefined;
  }
  return metadata as MessageMetadata;
}

/**
 * 浅合并元数据 patch 到 extras（保留其它 extras 键）。
 *
 * @param baseExtras - 原始 extras（可为 null）
 * @param patch - 要写入 openclaw 子对象的字段
 * @returns 新的 extras 对象（不 mutate 入参）
 */
export function mergeMetadata(
  baseExtras?: NativeExtras | null,
  patch: MessageMetadata = {},
): NativeExtras {
  const base = baseExtras ?? {};
  const existing = readMetadata(base) ?? {};
  return {
    ...base,
    [METADATA_EXTRAS_KEY]: {
      ...existing,
      ...patch,
    },
  };
}

/**
 * 标记 extras 为 OpenClaw 出站消息（供 {@link isOutboundEcho} 使用）。
 *
 * @param baseExtras - 原始 extras
 * @returns 带 `source` + `outbound: true` 的 extras
 */
export function markOutboundMetadata(baseExtras?: NativeExtras | null): NativeExtras {
  return mergeMetadata(baseExtras, {
    source: METADATA_SOURCE,
    outbound: true,
  });
}

/**
 * 判断入站消息是否为自身出站回声。
 *
 * @param input - 入站 carrier
 * @returns `true` 表示应跳过处理（避免 bot 回复触发自身）
 */
export function isOutboundEcho(input: MetadataCarrier): boolean {
  const metadata = readMetadata(input);
  return metadata?.source === METADATA_SOURCE && metadata.outbound === true;
}

/**
 * 解析元数据中的 peerId（trim 后非空才返回）。
 *
 * @param input - metadata carrier
 * @returns peer ID 或 undefined
 */
export function resolveMetadataPeerId(input: MetadataCarrier): string | undefined {
  const peerId = readMetadata(input)?.peerId;
  return typeof peerId === "string" && peerId.trim()
    ? peerId.trim()
    : undefined;
}

/**
 * 解析元数据中的 correlationId。
 *
 * @param input - metadata carrier
 * @returns correlation ID 或 undefined
 */
export function resolveMetadataCorrelationId(
  input: MetadataCarrier,
): string | undefined {
  const correlationId = readMetadata(input)?.correlationId;
  return typeof correlationId === "string" && correlationId.trim()
    ? correlationId.trim()
    : undefined;
}

/**
 * 解析元数据中的 traceId。
 *
 * @param input - metadata carrier
 * @returns trace ID 或 undefined
 */
export function resolveMetadataTraceId(input: MetadataCarrier): string | undefined {
  const traceId = readMetadata(input)?.traceId;
  return typeof traceId === "string" && traceId.trim()
    ? traceId.trim()
    : undefined;
}

/**
 * 解析并规范化 replyRoute（仅保留非空字符串值）。
 *
 * @param input - metadata carrier
 * @returns 有效的 ReplyRoute 或 undefined
 */
export function resolveMetadataReplyRoute(
  input: MetadataCarrier,
): ReplyRoute | undefined {
  const replyRoute = readMetadata(input)?.replyRoute;
  if (!isPlainObject(replyRoute)) {
    return undefined;
  }

  const normalized: ReplyRoute = {};
  for (const [key, value] of Object.entries(replyRoute)) {
    if (typeof value === "string" && value.trim()) {
      normalized[key] = value.trim();
    }
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

/** 从 carrier 解包 extras 记录（支持 flat extras 或 `{ extras }`） */
function resolveExtrasRecord(input: MetadataCarrier): NativeExtras | undefined {
  if (!isPlainObject(input)) {
    return undefined;
  }

  if (METADATA_EXTRAS_KEY in input) {
    return input as NativeExtras;
  }

  const maybeCarrier = input as { extras?: unknown };
  if ("extras" in maybeCarrier) {
    return isPlainObject(maybeCarrier.extras)
      ? (maybeCarrier.extras as NativeExtras)
      : undefined;
  }

  return input as NativeExtras;
}

/** 判断是否为 plain object（非数组、非 null） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

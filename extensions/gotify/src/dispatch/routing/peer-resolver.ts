/**
 * @file Gotify peer-resolver —— stream envelope → routing / UI 身份解析。
 *
 * @description 将 **无原生 IM 用户模型** 的 Gotify 消息，稳定映射为 OpenClaw `peerId`、
 * `ConversationLabel` 与 `SenderName`，供 session key、allowlist 与 Control UI 展示复用。
 * **模块角色**：Channel Plugin · Identity projection layer。
 */

import type { GotifyStreamEnvelope } from "../../types.js";
import { resolveMetadataPeerId } from "@partme.ai/openclaw-message-sdk/metadata";

/**
 * 判断 token 是否为纯数字。
 *
 * @param value - peerId、appid 或从 extras 中解析出的身份标识。
 * @returns true 表示该值是纯数字，通常代表 Gotify appid。
 */
function isNumericPeerToken(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

/**
 * 将纯数字 appid 格式化为可读展示名（对齐 Telegram/Feishu 对 numeric id 的处理习惯）。
 *
 * @param appid - Gotify Application ID。
 * @returns 面向 UI 的展示名，例如 `app 4`。
 */
export function formatGotifyAppDisplayName(appid: string | number): string {
  return `app ${String(appid).trim()}`;
}

/**
 * 从 Gotify stream 消息解析 peer ID（用于 resolveAgentRoute 的 peer.id）。
 * 优先级：extras.openclaw.peerId > appid > title > fallback 'gotify'
 *
 * @param message - Gotify stream 原始消息。
 * @returns 稳定对端 ID，用于路由、sessionKey 和 allowlist 匹配。
 */
export function resolveGotifyPeerId(message: GotifyStreamEnvelope): string {
  const extraPeerId = resolveMetadataPeerId(message);

  if (extraPeerId) {
    return extraPeerId.toLowerCase();
  }

  if (message.appid !== undefined && message.appid !== null) {
    return String(message.appid).trim().toLowerCase() || "gotify";
  }

  if (typeof message.title === "string" && message.title.trim()) {
    return message.title.trim().toLowerCase();
  }

  return "gotify";
}

/**
 * 解析会话标签中的应用名段（ConversationLabel 中间段，与 SenderName 来源一致）。
 *
 * @param message - Gotify stream 原始消息。
 * @param peerId - 已解析的稳定对端 ID。
 * @param appName - 通过 Application API 解析出的应用名。
 * @returns 适合放入 ConversationLabel 的可读应用名段。
 */
function resolveGotifyAppNameSegment(
  message: GotifyStreamEnvelope,
  peerId: string,
  appName?: string | null,
): string {
  const extraPeerId = resolveMetadataPeerId(message) ?? "";
  if (extraPeerId && !isNumericPeerToken(extraPeerId)) {
    return extraPeerId;
  }

  const resolvedAppName = typeof appName === "string" ? appName.trim() : "";
  if (resolvedAppName) {
    return resolvedAppName;
  }

  const title = typeof message.title === "string" ? message.title.trim() : "";
  if (title) {
    return title;
  }

  if (message.appid !== undefined && message.appid !== null) {
    return String(message.appid).trim();
  }

  if (isNumericPeerToken(peerId)) {
    return peerId;
  }

  return peerId;
}

/**
 * 构造 Gotify ConversationLabel 时可选的展示上下文。
 *
 * accountId 用于区分多账号会话；appName 用于把 Gotify 的数字 appid 转换为
 * 更容易阅读的应用名称。
 */
export type GotifyConversationLabelOptions = {
  /** OpenClaw 账号 ID，默认 default。 */
  accountId?: string;
  /** Gotify 应用 API 解析到的名称（可选）。 */
  appName?: string | null;
};

/**
 * 解析 Control UI 会话标签（写入 ConversationLabel / origin.label）。
 * 格式：gotify:{appName}:{accountId}:direct:{peerId}
 * per-account-channel-peer 路由下 parseGroupKey 无法解析 sessionKey，UI 会回退显示 origin.label。
 *
 * @param message - Gotify stream 原始消息。
 * @param peerId - 已解析的稳定对端 ID。
 * @param options - 账号 ID 与应用名；兼容旧调用方式直接传 appName 字符串。
 * @returns OpenClaw Control UI 可显示的会话标签。
 */
export function resolveGotifyConversationLabel(
  message: GotifyStreamEnvelope,
  peerId: string,
  options?: GotifyConversationLabelOptions | string | null,
): string {
  const normalizedOptions: GotifyConversationLabelOptions =
    typeof options === "string" || options === null || options === undefined
      ? { appName: options ?? undefined }
      : options;

  const accountId =
    (normalizedOptions.accountId ?? "default").trim() || "default";
  const appNameSegment = resolveGotifyAppNameSegment(
    message,
    peerId,
    normalizedOptions.appName,
  );

  return `gotify:${appNameSegment}:${accountId}:direct:${peerId}`;
}

/**
 * 解析发送方展示名（Session 元数据 / SenderName；direct 会话 label 的兜底来源）。
 * 优先级：API 应用名 > message.title > extras.openclaw.peerId（非纯数字）> app {appId} > peerId
 *
 * @param message - Gotify stream 原始消息。
 * @param peerId - 已解析的稳定对端 ID。
 * @param appName - 通过 Gotify Application API 解析出的应用名。
 * @returns 面向 transcript/UI 的发送方展示名。
 */
export function resolveGotifySenderName(
  message: GotifyStreamEnvelope,
  peerId: string,
  appName?: string | null,
): string {
  const resolvedAppName = typeof appName === "string" ? appName.trim() : "";
  if (resolvedAppName) {
    return resolvedAppName;
  }

  const title = typeof message.title === "string" ? message.title.trim() : "";
  if (title) {
    return title;
  }

  const extraPeerId = resolveMetadataPeerId(message) ?? "";
  if (extraPeerId && !isNumericPeerToken(extraPeerId)) {
    return extraPeerId;
  }

  if (message.appid !== undefined && message.appid !== null) {
    return formatGotifyAppDisplayName(message.appid);
  }

  if (isNumericPeerToken(peerId)) {
    return formatGotifyAppDisplayName(peerId);
  }

  return peerId;
}

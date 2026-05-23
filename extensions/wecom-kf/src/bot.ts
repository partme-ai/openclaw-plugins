/**
 * KF 客户入站消息解析（origin=3）。
 * 对齐 research/openclaw-china/extensions/wecom-kf/src/bot.ts，扩展多模态 msgtype。
 */

import type { KfMessage } from "./types/index.js";

/** origin=3 的客户消息（文本或多模态） */
export type KfInboundCustomerMessage = KfMessage & {
  origin: 3;
};

/** 可下载媒体的 msgtype */
export const KF_INBOUND_MEDIA_MSGTYPES = ["image", "voice", "video", "file"] as const;

export type KfInboundMediaMsgType = (typeof KF_INBOUND_MEDIA_MSGTYPES)[number];

/**
 * 判定是否为 origin=3 客户消息。
 */
export function isInboundCustomerMessage(msg: KfMessage): msg is KfInboundCustomerMessage {
  return msg.origin === 3;
}

/**
 * 从 KF 消息中提取 media_id（若存在）。
 */
export function extractInboundMediaId(msg: KfMessage): string | undefined {
  const msgtype = String(msg.msgtype ?? "").trim();
  const bucket = (msg as Record<string, unknown>)[msgtype] as { media_id?: string } | undefined;
  const mediaId = bucket?.media_id?.trim();
  return mediaId || undefined;
}

/**
 * 提取客户可读文本/占位描述；无法识别时返回 undefined。
 */
export function extractInboundTextContent(msg: KfMessage): string | undefined {
  if (!isInboundCustomerMessage(msg)) return undefined;

  const msgtype = String(msg.msgtype ?? "").trim();
  switch (msgtype) {
    case "text": {
      const content = msg.text?.content?.trim();
      return content || undefined;
    }
    case "image": {
      const mediaId = extractInboundMediaId(msg);
      return mediaId ? `[图片] media_id=${mediaId}` : undefined;
    }
    case "voice": {
      const mediaId = extractInboundMediaId(msg);
      return mediaId ? `[语音] media_id=${mediaId}` : undefined;
    }
    case "video": {
      const mediaId = extractInboundMediaId(msg);
      return mediaId ? `[视频] media_id=${mediaId}` : undefined;
    }
    case "file": {
      const mediaId = extractInboundMediaId(msg);
      return mediaId ? `[文件] media_id=${mediaId}` : undefined;
    }
    case "location": {
      const loc = (msg as Record<string, unknown>).location as
        | { name?: string; address?: string; latitude?: number; longitude?: number }
        | undefined;
      if (!loc) return undefined;
      const parts = ["[位置]"];
      if (loc.name) parts.push(loc.name);
      if (loc.address) parts.push(loc.address);
      if (loc.latitude != null && loc.longitude != null) {
        parts.push(`(${loc.latitude}, ${loc.longitude})`);
      }
      return parts.join(" ");
    }
    case "link": {
      const link = (msg as Record<string, unknown>).link as
        | { title?: string; desc?: string; url?: string }
        | undefined;
      if (!link) return undefined;
      const title = link.title ?? "链接";
      const url = link.url ?? "";
      const desc = link.desc ? ` - ${link.desc}` : "";
      return `[链接] ${title}${desc} ${url}`.trim();
    }
    case "miniprogram": {
      const mini = (msg as Record<string, unknown>).miniprogram as { title?: string } | undefined;
      return mini ? `[小程序] ${mini.title ?? "小程序"}` : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * 提取客户文本内容；非 origin=3 或无内容时返回 undefined。
 * @deprecated 使用 extractInboundTextContent
 */
export function extractInboundText(msg: KfMessage): string | undefined {
  return extractInboundTextContent(msg);
}

/** @deprecated 使用 isInboundCustomerMessage + extractInboundTextContent */
export function isInboundCustomerTextMessage(
  msg: KfMessage,
): msg is KfMessage & { msgtype: "text"; origin: 3; text: { content: string } } {
  return msg.origin === 3 && msg.msgtype === "text";
}

/**
 * 判断 msgtype 是否为需下载的媒体类型。
 */
export function isInboundMediaMessage(msg: KfMessage): msg is KfMessage & { msgtype: KfInboundMediaMsgType } {
  if (!isInboundCustomerMessage(msg)) return false;
  return (KF_INBOUND_MEDIA_MSGTYPES as readonly string[]).includes(String(msg.msgtype ?? ""));
}

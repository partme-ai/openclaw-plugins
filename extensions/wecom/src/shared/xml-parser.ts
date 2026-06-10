/**
 * WeCom Agent 模式 XML 入站解析器（shared/xml-parser）
 *
 * Agent 回调为 XML 明文/加密体，本模块负责解析为 `WecomAgentInboundMessage` 并提取常用字段。
 * 与 message-sdk 无直接依赖：message-sdk 处理通用入站/出站管线，XML 形态为 WeCom Agent 专有协议。
 *
 * 使用 fast-xml-parser；字段名兼容企微大小写变体（MsgId/MsgID、MediaId/MediaID 等）。
 */

import { XMLParser } from "fast-xml-parser";
import type { WecomAgentInboundMessage } from "../types/index.js";

const xmlParser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
    processEntities: false,
    parseTagValue: false,
    parseAttributeValue: false,
});

/**
 * 解析 XML 字符串为扁平消息对象。
 *
 * @param xml 企微 Agent 回调原始 XML
 * @returns 根节点 `xml` 下的字段对象，解析失败时返回空对象
 */
export function parseXml(xml: string): WecomAgentInboundMessage {
    const obj = xmlParser.parse(xml);
    const root = obj?.xml ?? obj;
    return root ?? {};
}

/**
 * 提取消息类型（小写），对应 XML 字段 MsgType。
 *
 * @param msg 已解析的 Agent 入站消息
 */
export function extractMsgType(msg: WecomAgentInboundMessage): string {
    return String(msg.MsgType ?? "").toLowerCase();
}

/**
 * 提取发送者 userid（FromUserName）。
 *
 * @param msg 已解析的 Agent 入站消息
 */
export function extractFromUser(msg: WecomAgentInboundMessage): string {
    return String(msg.FromUserName ?? "");
}

/**
 * 提取文件名（file 消息），兼容 FileName / Filename 等多种键名及 fast-xml-parser 的 `#text` 嵌套。
 *
 * @param msg 已解析的 Agent 入站消息
 */
export function extractFileName(msg: WecomAgentInboundMessage): string | undefined {
    const raw = (msg as any).FileName ?? (msg as any).Filename ?? (msg as any).fileName ?? (msg as any).filename;
    if (raw == null) return undefined;
    if (typeof raw === "string") return raw.trim() || undefined;
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw);
    if (Array.isArray(raw)) {
        const merged = raw.map((v) => (v == null ? "" : String(v))).join("\n").trim();
        return merged || undefined;
    }
    if (typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        const text = (typeof obj["#text"] === "string" ? obj["#text"] :
            typeof obj["_text"] === "string" ? obj["_text"] :
                typeof obj["text"] === "string" ? obj["text"] : undefined);
        if (text && text.trim()) return text.trim();
    }
    const s = String(raw);
    return s.trim() || undefined;
}

/**
 * 提取接收方标识 ToUserName（通常为企业 CorpID）。
 */
export function extractToUser(msg: WecomAgentInboundMessage): string {
    return String(msg.ToUserName ?? "");
}

/** 提取群聊 ChatId（群会话时存在）。 */
export function extractChatId(msg: WecomAgentInboundMessage): string | undefined {
    return msg.ChatId ? String(msg.ChatId) : undefined;
}

/**
 * 提取应用 AgentID，兼容 AgentID / AgentId / agentid 等大小写。
 */
export function extractAgentId(msg: WecomAgentInboundMessage): string | number | undefined {
    const raw =
        (msg as any).AgentID ??
        (msg as any).AgentId ??
        (msg as any).agentid ??
        (msg as any).agentId;
    if (raw == null) return undefined;
    if (typeof raw === "string") return raw.trim() || undefined;
    if (typeof raw === "number") return raw;
    const asString = String(raw).trim();
    return asString || undefined;
}

/**
 * 将各 MsgType 转为供 Agent 消费的文本摘要（非原始 XML）。
 *
 * 复杂逻辑：voice 优先 Recognition；image/link/location 等格式化为可读占位；
 * event 类型拼接 Event + EventKey。
 *
 * @param msg 已解析的 Agent 入站消息
 */
export function extractContent(msg: WecomAgentInboundMessage): string {
    const msgType = extractMsgType(msg);

    /** 将 XML 节点值（含 #text / 数组）统一转为字符串 */
    const asText = (value: unknown): string => {
        if (value == null) return "";
        if (typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
        if (Array.isArray(value)) return value.map(asText).filter(Boolean).join("\n");
        if (typeof value === "object") {
            const obj = value as Record<string, unknown>;
            // fast-xml-parser 在某些情况下（例如带属性）会把文本放在 "#text"
            if (typeof obj["#text"] === "string") return obj["#text"];
            if (typeof obj["_text"] === "string") return obj["_text"];
            if (typeof obj["text"] === "string") return obj["text"];
            try {
                return JSON.stringify(obj);
            } catch {
                return String(value);
            }
        }
        return String(value);
    };

    switch (msgType) {
        case "text":
            return asText(msg.Content);
        case "voice":
            // 语音识别结果
            return asText(msg.Recognition) || "[语音消息]";
        case "image":
            return `[图片] ${asText(msg.PicUrl)}`;
        case "file":
            return "[文件消息]";
        case "video":
            return "[视频消息]";
        case "location":
            return `[位置] ${asText(msg.Label)} (${asText(msg.Location_X)}, ${asText(msg.Location_Y)})`;
        case "link":
            return `[链接] ${asText(msg.Title)}\n${asText(msg.Description)}\n${asText(msg.Url)}`;
        case "event":
            return `[事件] ${asText(msg.Event)} - ${asText(msg.EventKey)}`;
        default:
            return `[${msgType || "未知消息类型"}]`;
    }
}

/**
 * 提取媒体 MediaId（图片/语音/视频等），位于 XML 根节点。
 * 兼容 MediaId / MediaID / mediaid 等键名。
 */
export function extractMediaId(msg: WecomAgentInboundMessage): string | undefined {
    const raw = (msg as any).MediaId ?? (msg as any).MediaID ?? (msg as any).mediaid ?? (msg as any).mediaId;
    if (raw == null) return undefined;
    if (typeof raw === "string") return raw.trim() || undefined;
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw);
    if (Array.isArray(raw)) {
        const merged = raw.map((v) => (v == null ? "" : String(v))).join("\n").trim();
        return merged || undefined;
    }
    if (typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        const text = (typeof obj["#text"] === "string" ? obj["#text"] :
            typeof obj["_text"] === "string" ? obj["_text"] :
                typeof obj["text"] === "string" ? obj["text"] : undefined);
        if (text && text.trim()) return text.trim();
        try {
            const s = JSON.stringify(obj);
            return s.trim() || undefined;
        } catch {
            const s = String(raw);
            return s.trim() || undefined;
        }
    }
    const s = String(raw);
    return s.trim() || undefined;
}

/**
 * 提取 MsgId，供入站去重（与 message-sdk createPersistentDedupe 配合使用）。
 */
export function extractMsgId(msg: WecomAgentInboundMessage): string | undefined {
    const raw = (msg as any).MsgId ?? (msg as any).MsgID ?? (msg as any).msgid ?? (msg as any).msgId;
    if (raw == null) return undefined;
    if (typeof raw === "string") return raw.trim() || undefined;
    if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "bigint") return String(raw);
    if (Array.isArray(raw)) {
        const merged = raw.map((v) => (v == null ? "" : String(v))).join("\n").trim();
        return merged || undefined;
    }
    if (typeof raw === "object") {
        const obj = raw as Record<string, unknown>;
        const text = (typeof obj["#text"] === "string" ? obj["#text"] :
            typeof obj["_text"] === "string" ? obj["_text"] :
                typeof obj["text"] === "string" ? obj["text"] : undefined);
        if (text && text.trim()) return text.trim();
        try {
            const s = JSON.stringify(obj);
            return s.trim() || undefined;
        } catch {
            const s = String(raw);
            return s.trim() || undefined;
        }
    }
    const s = String(raw);
    return s.trim() || undefined;
}

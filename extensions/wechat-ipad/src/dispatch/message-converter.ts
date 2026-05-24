/**
 * 消息格式转换器
 *
 * 负责 iPad 协议服务原始消息 ↔ OpenClaw 文本消息的双向转换：
 * - 入站：将微信消息（文本/图片/链接等）转为 Agent 可理解的文本
 * - 出站：将 Agent 回复文本转为 iPad 协议服务的发送请求
 */

import { WxMsgType } from "../types.js";
import type { WxMessagePayload, SendMessageRequest } from "../types.js";

/**
 * 将微信入站消息转换为 Agent 可处理的文本
 *
 * 不同消息类型的处理策略：
 * - 文本消息：直接取 content
 * - 图片/语音/视频：生成描述性文本 + 原始 XML
 * - 链接：提取标题和 URL
 * - 位置：提取坐标和地名
 * - 名片/小程序：生成结构化描述
 *
 * @param msg - 微信消息负载
 * @returns 转换后的文本（用于 Agent 处理）
 */
export function inboundToText(msg: WxMessagePayload): string | null {
  switch (msg.msgType) {
    case WxMsgType.Text:
      return extractTextContent(msg);

    case WxMsgType.Image:
      return `[图片消息] ${msg.rawXml ? extractXmlField(msg.rawXml, "cdnurl") || "(图片)" : "(图片)"}`;

    case WxMsgType.Voice:
      return "[语音消息] (语音转文字暂不支持)";

    case WxMsgType.Video:
      return "[视频消息]";

    case WxMsgType.Emoji:
      return "[表情消息]";

    case WxMsgType.Card:
      return formatCardMessage(msg);

    case WxMsgType.Location:
      return formatLocationMessage(msg);

    case WxMsgType.Link:
      return formatLinkMessage(msg);

    case WxMsgType.MiniApp:
      return formatMiniAppMessage(msg);

    case WxMsgType.System:
    case WxMsgType.SystemExtend:
      return null;

    default:
      return msg.content ?? `[未知消息类型: ${msg.msgType}]`;
  }
}

/**
 * 将 Agent 回复文本转换为 iPad 协议服务的发送请求
 *
 * @param toWxid - 目标微信用户/群 wxid
 * @param text - Agent 回复文本
 * @returns 发送消息请求对象
 */
export function outboundFromText(
  toWxid: string,
  text: string
): SendMessageRequest {
  return {
    toWxid,
    msgType: "text",
    content: text,
  };
}

/**
 * 提取文本消息内容
 * 群消息中文本可能包含 "wxid:\n实际内容" 格式，需要去除前缀
 *
 * @param msg - 微信消息负载
 * @returns 清洗后的文本内容
 */
function extractTextContent(msg: WxMessagePayload): string | null {
  if (!msg.content) return null;

  if (msg.isGroup && msg.groupSenderWxid) {
    const prefix = `${msg.groupSenderWxid}:\n`;
    if (msg.content.startsWith(prefix)) {
      return msg.content.slice(prefix.length).trim();
    }
  }

  return msg.content.trim();
}

/**
 * 格式化名片消息
 *
 * @param msg - 名片消息负载
 * @returns 格式化文本
 */
function formatCardMessage(msg: WxMessagePayload): string {
  if (!msg.rawXml) return "[名片消息]";
  const nickname = extractXmlField(msg.rawXml, "nickname") ?? "未知";
  const alias = extractXmlField(msg.rawXml, "alias") ?? "";
  return `[名片] ${nickname}${alias ? ` (${alias})` : ""}`;
}

/**
 * 格式化位置消息
 *
 * @param msg - 位置消息负载
 * @returns 格式化文本
 */
function formatLocationMessage(msg: WxMessagePayload): string {
  if (!msg.rawXml) return "[位置消息]";
  const label = extractXmlField(msg.rawXml, "label") ?? "未知位置";
  const lat = extractXmlField(msg.rawXml, "x");
  const lng = extractXmlField(msg.rawXml, "y");
  const coords = lat && lng ? ` (${lat}, ${lng})` : "";
  return `[位置] ${label}${coords}`;
}

/**
 * 格式化链接/文章消息
 *
 * @param msg - 链接消息负载
 * @returns 格式化文本
 */
function formatLinkMessage(msg: WxMessagePayload): string {
  if (!msg.rawXml) return "[链接消息]";
  const title = extractXmlField(msg.rawXml, "title") ?? "无标题";
  const desc = extractXmlField(msg.rawXml, "des") ?? "";
  const url = extractXmlField(msg.rawXml, "url") ?? "";
  const parts = [`[链接] ${title}`];
  if (desc) parts.push(desc);
  if (url) parts.push(url);
  return parts.join("\n");
}

/**
 * 格式化小程序消息
 *
 * @param msg - 小程序消息负载
 * @returns 格式化文本
 */
function formatMiniAppMessage(msg: WxMessagePayload): string {
  if (!msg.rawXml) return "[小程序消息]";
  const title = extractXmlField(msg.rawXml, "title") ?? "未知小程序";
  const sourcedisplayname = extractXmlField(msg.rawXml, "sourcedisplayname") ?? "";
  return `[小程序] ${sourcedisplayname ? `${sourcedisplayname}: ` : ""}${title}`;
}

/**
 * 从 XML 字符串中提取指定字段值
 * 使用简单正则匹配，适用于微信消息的 XML 结构
 *
 * @param xml - XML 字符串
 * @param field - 字段名（标签名或属性名）
 * @returns 字段值，未找到返回 null
 */
export function extractXmlField(xml: string, field: string): string | null {
  // 属性模式：field="value"
  const attrPattern = new RegExp(`${field}="([^"]*)"`, "i");
  const attrMatch = xml.match(attrPattern);
  if (attrMatch) return attrMatch[1];

  // 标签模式：<field>value</field>
  const tagPattern = new RegExp(`<${field}>([^<]*)</${field}>`, "i");
  const tagMatch = xml.match(tagPattern);
  if (tagMatch) return tagMatch[1];

  // CDATA 模式：<field><![CDATA[value]]></field>
  const cdataPattern = new RegExp(
    `<${field}><!\\[CDATA\\[([^\\]]*?)\\]\\]></${field}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1];

  return null;
}

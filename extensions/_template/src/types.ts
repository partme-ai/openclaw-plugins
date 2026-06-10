export type { ResolvedAccount, TemplateConfig } from "./config.js";

/** 入站消息解析结果。 */
export interface ParsedInboundMessage {
  messageId?: string;
  senderId: string;
  chatId: string;
  chatType: "direct" | "group";
  contentType: "text" | "image" | "voice" | "video" | "file" | "mixed";
  text?: string;
  mediaUrl?: string;
  timestamp: number;
}

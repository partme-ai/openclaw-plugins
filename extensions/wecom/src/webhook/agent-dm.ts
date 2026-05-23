/**
 * Agent 模式私信兜底（企微官方 message/send API，经 api-client）。
 */

import { fetchWithSsrFGuard } from "../runtime-api.js";
import { sendText as sendAgentText, uploadMedia, sendMedia as sendAgentMedia } from "../agent/api-client.js";
import type { WecomWebhookTarget } from "./types.js";

/** 通过 Agent 私信发送文本 */
export async function agentDmText(params: {
  target: WecomWebhookTarget;
  userId: string;
  text: string;
}): Promise<void> {
  const { target, userId, text } = params;
  if (!target.account.agent?.configured) {
    throw new Error("Agent credentials not configured");
  }
  const agent = target.account.agent;
  const chunks = target.core.channel.text.chunkText(text, 20480);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    await sendAgentText({
      agent,
      toUser: userId,
      text: trimmed,
    });
  }
}

/** 通过 Agent 私信发送媒体 */
export async function agentDmMedia(params: {
  target: WecomWebhookTarget;
  userId: string;
  mediaUrlOrPath: string;
  contentType?: string;
  filename: string;
}): Promise<void> {
  const { target, userId, mediaUrlOrPath, filename } = params;
  if (!target.account.agent?.configured) {
    throw new Error("Agent credentials not configured");
  }
  const agent = target.account.agent;
  let buffer: Buffer;
  let inferredContentType = params.contentType;

  const looksLikeUrl = /^https?:\/\//i.test(mediaUrlOrPath);
  if (looksLikeUrl) {
    const { response: res, release } = await fetchWithSsrFGuard({
      url: mediaUrlOrPath,
      timeoutMs: 30_000,
    });
    try {
      if (!res.ok) throw new Error(`media download failed: ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
      inferredContentType =
        inferredContentType || res.headers.get("content-type") || "application/octet-stream";
    } finally {
      await release();
    }
  } else {
    const fs = await import("node:fs/promises");
    buffer = await fs.readFile(mediaUrlOrPath);
  }

  let mediaType: "image" | "voice" | "video" | "file" = "file";
  const ct = (inferredContentType || "").toLowerCase();
  if (ct.startsWith("image/")) mediaType = "image";
  else if (ct.startsWith("audio/")) mediaType = "voice";
  else if (ct.startsWith("video/")) mediaType = "video";

  const mediaId = await uploadMedia({ agent, type: mediaType, buffer, filename });

  await sendAgentMedia({
    agent,
    toUser: userId,
    mediaId,
    mediaType,
    ...(mediaType === "video" ? { title: filename, description: "" } : {}),
  });
}

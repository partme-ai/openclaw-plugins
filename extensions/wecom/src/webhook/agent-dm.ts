/**
 * @module webhook/agent-dm
 *
 * Agent 模式**私信兜底**（企微官方 message/send API，经 api-client）。
 *
 * **职责**：
 * - 非图片文件、超时剩余内容等场景，通过自建应用私信用户
 * - 本地媒体经 Path Guard 读取；HTTP URL 经 SSRF Guard 下载
 *
 * **与 message-sdk 关系**：
 * - 本地读取：`readGuardedLocalMediaFile` / `getExtendedMediaLocalRoots`
 * - 与 Bot 原会话交付互补（Bot 负责群内可见提示 + 图片 stream 帧）
 *
 * **关键导出**：`agentDmText`、`agentDmMedia`
 */

import { fetchWithSsrFGuard } from "../runtime/runtime-api.js";
import { sendText as sendAgentText, uploadMedia, sendMedia as sendAgentMedia } from "../agent/api-client.js";
import {
  getExtendedMediaLocalRoots,
  readGuardedLocalMediaFile,
} from "../media/media-path-guard.js";
import { resolveWecomMediaMaxBytes } from "./inbound-helpers.js";
import type { WecomWebhookTarget } from "./types.js";

/**
 * 通过 Agent 私信发送文本（超长自动分块 20KB）。
 *
 * @param params.target - Webhook Target（含 Agent 凭证）
 * @param params.userId - 接收者 userid
 * @param params.text - 正文
 * @returns Promise
 */
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

/**
 * 通过 Agent 私信发送媒体（上传 + sendMedia）。
 *
 * WHY：Bot 流式通道不适合大文件/非图片；Agent 私信是官方推荐的文件兜底通道。
 *
 * @param params.target - Webhook Target
 * @param params.userId - 接收者 userid
 * @param params.mediaUrlOrPath - HTTP URL 或本地路径
 * @param params.contentType - 可选 MIME
 * @param params.filename - 展示文件名
 * @returns Promise
 */
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
    const mediaLocalRoots = await getExtendedMediaLocalRoots(target.account.config);
    const maxBytes = resolveWecomMediaMaxBytes(target.config);
    const readResult = await readGuardedLocalMediaFile({
      filePath: mediaUrlOrPath,
      allowedRoots: mediaLocalRoots,
      maxBytes,
    });
    if (!readResult.ok) {
      target.runtime.error?.(
        `[webhook] agent-dm: 本地媒体读取失败 path=${mediaUrlOrPath}: ${readResult.error}`,
      );
      throw new Error(readResult.error);
    }
    buffer = readResult.buffer;
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

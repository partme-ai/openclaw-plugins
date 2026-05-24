/**
 * @module dispatch/outbound-reply
 *
 * 小红书 Agent 回复出站：MEDIA 指令解析与 resolveOutboundMedia。
 */

import {
  isHttpUrl,
  parseMediaDirectives,
  resolveOutboundMedia,
  type ChannelLimitsOpenClawConfig,
} from "../runtime/runtime-api.js";
import { resolveXhsMediaMaxBytes } from "../config/resolvers.js";

/**
 * 解析并占位投递 Agent 回复。
 */
export async function deliverXhsAgentReplyPayload(params: {
  cfg: Record<string, unknown>;
  shopId: string;
  peerId: string;
  text: string;
  mediaUrls?: string[];
  log?: (message: string) => void;
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseMediaDirectives(params.text);
  const mediaPaths = Array.from(
    new Set([...(params.mediaUrls ?? []), ...parsed.paths].map((item) => item.trim()).filter(Boolean)),
  );
  const cfg = params.cfg as ChannelLimitsOpenClawConfig;
  const maxBytes = resolveXhsMediaMaxBytes(cfg);

  if (parsed.text.trim()) {
    params.log?.(
      `[rednode] 出站文本（shop=${params.shopId} peer=${params.peerId}）：${parsed.text.slice(0, 120)}`,
    );
  }

  for (const mediaPath of mediaPaths) {
    try {
      if (isHttpUrl(mediaPath)) {
        await resolveOutboundMedia({
          pathOrUrl: mediaPath,
          fetchRemoteMedia: async ({ url }) => {
            const res = await fetch(url);
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.byteLength > maxBytes) {
              throw new Error(`media exceeds maxBytes (${maxBytes})`);
            }
            return {
              buffer,
              contentType: res.headers.get("content-type") ?? undefined,
            };
          },
        });
      } else {
        await resolveOutboundMedia({ pathOrUrl: mediaPath });
      }
      params.log?.(`[rednode] 出站媒体已解析：${mediaPath}（OpenAPI 对称发送待接）`);
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  if (!parsed.text.trim() && mediaPaths.length === 0) {
    return { ok: false, error: "empty agent reply" };
  }

  params.log?.(
    "[rednode] 出站占位成功；请接小红书 OpenAPI 消息推送 API 完成对称回复。",
  );
  return { ok: true };
}

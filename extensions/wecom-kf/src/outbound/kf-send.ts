/**
 * KF 出站：解析目标并调用 send_msg API（文本 + 媒体）。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";
import {
  isHttpUrl,
  parseMediaDirectives,
  resolveOutboundMedia,
} from "@partme.ai/openclaw-message-sdk";

import {
  sendKfMediaMessage,
  sendKfTextMessage,
  summarizeSendResults,
} from "../agent/api-client.js";
import { resolveKfAccountByOpenKfId, resolveWecomAccount } from "../config/index.js";
import { getExtendedMediaLocalRoots, readGuardedLocalMediaFile } from "../media/path-guard.js";
import type { ResolvedAgentAccount } from "../types/index.js";
import type { WecomConfig } from "../types/config.js";
import { getWecomKfChannelBlock } from "../config/channel-block.js";

/**
 * 规范化 KF 外部联系人 ID（external_userid）。
 */
export function normalizeKfExternalUserId(rawTarget: string): string {
  let normalized = rawTarget.trim();
  normalized = normalized.replace(/^(wecom-kf|wecom-kf-agent|wecom-cs-agent|wecom-cs|wecom-agent|wecom):/i, "");
  if (normalized.startsWith("user:")) {
    normalized = normalized.slice("user:".length);
  }
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex > 0) {
    normalized = normalized.slice(0, atIndex);
  }
  return normalized.trim();
}

/**
 * 解析 KF 出站所需的 Agent 凭证与 open_kfid。
 */
export function resolveKfOutboundContext(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
  to: string;
}): { agent: ResolvedAgentAccount; openKfId: string; externalUserId: string } {
  const account = resolveWecomAccount({ cfg: params.cfg, accountId: params.accountId });
  const kfConfig = account.config;
  const openKfId = kfConfig.openKfId?.trim();
  if (!openKfId) {
    throw new Error(
      "WeCom KF outbound requires openKfId. Configure channels.wecom-kf.accounts.<accountId>.openKfId.",
    );
  }

  const corpId = kfConfig.corpId?.trim();
  const corpSecret = kfConfig.corpSecret?.trim();
  if (!corpId || !corpSecret) {
    throw new Error(
      "WeCom KF outbound requires corpId and corpSecret for active sending.",
    );
  }

  const externalUserId = normalizeKfExternalUserId(params.to);
  if (!externalUserId) {
    throw new Error("WeCom KF outbound target is empty.");
  }

  const agent: ResolvedAgentAccount = {
    accountId: account.accountId,
    enabled: account.enabled,
    configured: true,
    corpId,
    corpSecret,
    token: kfConfig.token ?? "",
    encodingAESKey: kfConfig.encodingAESKey ?? "",
    config: {
      corpId,
      corpSecret,
      token: kfConfig.token ?? "",
      encodingAESKey: kfConfig.encodingAESKey ?? "",
    },
  };

  return { agent, openKfId, externalUserId };
}

/**
 * 发送 KF 文本消息。
 */
export async function sendKfOutboundText(params: {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  accountId?: string | null;
}): Promise<{ ok: boolean; messageId: string; error?: string }> {
  const { agent, openKfId, externalUserId } = resolveKfOutboundContext(params);
  const results = await sendKfTextMessage({
    agent,
    externalUserId,
    text: params.text,
    openKfId,
  });
  const summary = summarizeSendResults(results);
  return {
    ok: summary.ok,
    messageId: summary.msgid ?? `kf-${Date.now()}`,
    error: summary.error,
  };
}

/**
 * 加载出站媒体字节（远程 URL 或本地路径，本地路径走 path guard）。
 */
async function loadKfOutboundMediaBuffer(params: {
  cfg: OpenClawConfig;
  mediaPath: string;
}): Promise<{ buffer: Buffer; contentType?: string; filename: string }> {
  const source = params.mediaPath.trim();
  if (isHttpUrl(source)) {
    const loaded = await resolveOutboundMedia({ pathOrUrl: source });
    return {
      buffer: loaded.buffer,
      contentType: loaded.contentType,
      filename: loaded.filename,
    };
  }

  const wecomConfig = getWecomKfChannelBlock(params.cfg) as WecomConfig | undefined;
  const allowedRoots = await getExtendedMediaLocalRoots(wecomConfig);
  const guarded = await readGuardedLocalMediaFile({ filePath: source, allowedRoots });
  if (!guarded.ok) {
    throw new Error(guarded.error);
  }

  const pathMod = await import("node:path");
  return {
    buffer: guarded.buffer,
    filename: pathMod.basename(source),
  };
}

/**
 * 发送 KF 媒体出站（单文件 + 可选 caption 文本）。
 */
export async function sendKfOutboundMedia(params: {
  cfg: OpenClawConfig;
  to: string;
  text?: string;
  mediaUrl?: string;
  accountId?: string | null;
}): Promise<{ ok: boolean; messageId: string; error?: string }> {
  const { agent, openKfId, externalUserId } = resolveKfOutboundContext(params);
  const mediaUrl = params.mediaUrl?.trim();
  if (!mediaUrl) {
    throw new Error("WeCom KF media outbound requires mediaUrl");
  }

  const results: Array<{ errcode: number; errmsg: string; msgid?: string }> = [];

  const caption = String(params.text ?? "").trim();
  if (caption) {
    const textResults = await sendKfTextMessage({
      agent,
      externalUserId,
      text: caption,
      openKfId,
    });
    results.push(...textResults);
    const textSummary = summarizeSendResults(textResults);
    if (!textSummary.ok) {
      return {
        ok: false,
        messageId: textSummary.msgid ?? `kf-${Date.now()}`,
        error: textSummary.error,
      };
    }
  }

  const loaded = await loadKfOutboundMediaBuffer({ cfg: params.cfg, mediaPath: mediaUrl });
  const mediaResult = await sendKfMediaMessage({
    agent,
    externalUserId,
    openKfId,
    buffer: loaded.buffer,
    filename: loaded.filename,
    contentType: loaded.contentType,
  });
  results.push(mediaResult);

  const summary = summarizeSendResults(results);
  return {
    ok: summary.ok,
    messageId: summary.msgid ?? `kf-${Date.now()}`,
    error: summary.error,
  };
}

/**
 * 解析 Agent 回复中的 MEDIA: 指令并发送媒体；返回剥离指令后的文本。
 */
export async function deliverKfAgentReplyPayload(params: {
  cfg: OpenClawConfig;
  openKfId: string;
  externalUserId: string;
  agent: ResolvedAgentAccount;
  text: string;
  mediaUrls?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const parsed = parseMediaDirectives(params.text);
  const mediaPaths = Array.from(
    new Set([...(params.mediaUrls ?? []), ...parsed.paths].map((item) => item.trim()).filter(Boolean)),
  );

  if (parsed.text.trim()) {
    const textResults = await sendKfTextMessage({
      agent: params.agent,
      externalUserId: params.externalUserId,
      text: parsed.text,
      openKfId: params.openKfId,
    });
    const textSummary = summarizeSendResults(textResults);
    if (!textSummary.ok) {
      return { ok: false, error: textSummary.error };
    }
  }

  for (const mediaPath of mediaPaths) {
    try {
      const loaded = await loadKfOutboundMediaBuffer({ cfg: params.cfg, mediaPath });
      const result = await sendKfMediaMessage({
        agent: params.agent,
        externalUserId: params.externalUserId,
        openKfId: params.openKfId,
        buffer: loaded.buffer,
        filename: loaded.filename,
        contentType: loaded.contentType,
      });
      if (result.errcode !== 0) {
        return { ok: false, error: result.errmsg || `media send failed (${result.errcode})` };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  return { ok: true };
}

/**
 * 按 open_kfid 从 bindings 解析出站上下文（多账号矩阵）。
 */
export function resolveKfOutboundByOpenKfId(params: {
  cfg: OpenClawConfig;
  openKfId?: string;
  to: string;
}): ReturnType<typeof resolveKfOutboundContext> | undefined {
  const resolved = resolveKfAccountByOpenKfId({ cfg: params.cfg, openKfId: params.openKfId });
  if (!resolved?.config) return undefined;
  const corpId = resolved.config.corpId?.trim();
  const corpSecret = resolved.config.corpSecret?.trim();
  const openKfId = resolved.config.openKfId?.trim();
  if (!corpId || !corpSecret || !openKfId) return undefined;

  const externalUserId = normalizeKfExternalUserId(params.to);
  if (!externalUserId) return undefined;

  return {
    agent: {
      accountId: resolved.accountKey,
      enabled: true,
      configured: true,
      corpId,
      corpSecret,
      token: resolved.config.token ?? "",
      encodingAESKey: resolved.config.encodingAESKey ?? "",
      config: {
        corpId,
        corpSecret,
        token: resolved.config.token ?? "",
        encodingAESKey: resolved.config.encodingAESKey ?? "",
      },
    },
    openKfId,
    externalUserId,
  };
}

/**
 * 抖音 Webhook 入站访问控制。
 *
 * 自定义 HTTP handler 不会自动经过 `createChatChannelPlugin.security.dm`，因此必须在
 * 进入 Agent Transcript 前显式执行 DM policy 与命令授权。否则 manifest 虽然暴露
 * `dmPolicy/allowFrom`，实际入站仍会被硬编码的 `CommandAuthorized: true` 绕过。
 */
import type { OpenClawConfig, PluginRuntime } from "openclaw/plugin-sdk/core";
import {
  checkChannelDmPolicy,
  createAllowFromNormalizer,
  resolveCommandAuthorization,
} from "@partme.ai/openclaw-message-sdk/ingress";

import type { ResolvedDouyinAccount } from "../types.js";

const CHANNEL_ID = "douyin";
const normalizeAllowFrom = createAllowFromNormalizer({
  channelId: CHANNEL_ID,
  stripPrefixes: ["user:", "userid:", "open_id:"],
});

/** 策略层返回给派发器的最小可信结论。 */
export type DouyinInboundAuthorization = {
  allowed: boolean;
  commandAuthorized: boolean;
};

/**
 * 校验发送者是否允许触发 Agent，并为 slash command 计算 OpenClaw 命令权限。
 *
 * 抖音生活服务 Webhook 没有通用被动回复 API，pairing 模式会创建宿主 pairing 请求，
 * 但不会把配对码写入 HTTP 响应或日志；管理员需通过 OpenClaw pairing 命令查看并批准。
 */
export async function authorizeDouyinInbound(params: {
  runtime: PluginRuntime;
  cfg: Record<string, unknown>;
  account: ResolvedDouyinAccount;
  peerId: string;
  rawText: string;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
}): Promise<DouyinInboundAuthorization> {
  const { runtime, account, peerId } = params;
  const pairing = runtime.channel?.pairing;
  const runtimeLog = {
    log: (message: unknown) => params.log?.info?.(String(message)),
    error: (message: unknown) => params.log?.error?.(String(message)),
  };

  const dm = await checkChannelDmPolicy({
    channelId: CHANNEL_ID,
    senderId: peerId,
    isGroup: false,
    accountId: account.accountId,
    dmPolicy: account.config.dmPolicy,
    configAllowFrom: account.config.allowFrom,
    runtime: runtimeLog,
    logPrefix: `[douyin:${account.accountId}]`,
    readPairingAllowFrom: async ({ channelId, accountId }) =>
      pairing?.readAllowFromStore
        ? pairing.readAllowFromStore({ channel: channelId, accountId })
        : [],
    upsertPairingRequest: pairing?.upsertPairingRequest
      ? async ({ channelId, senderId, accountId }) => {
          const result = await pairing.upsertPairingRequest({
            channel: channelId,
            id: senderId,
            accountId,
            meta: { name: senderId },
          });
          return { code: result.code, created: result.created };
        }
      : undefined,
  });
  if (!dm.allowed) {
    params.log?.warn?.(
      `[douyin] blocked sender=${peerId} by dmPolicy=${account.config.dmPolicy ?? "open"}`,
    );
    return { allowed: false, commandAuthorized: false };
  }

  const commands = runtime.channel?.commands;
  if (
    !commands?.shouldComputeCommandAuthorized ||
    !commands.resolveCommandAuthorizedFromAuthorizers
  ) {
    // 老宿主或裁剪 runtime 没有命令鉴权能力时，只允许普通消息；含命令的文本保守拒绝。
    const looksLikeCommand = params.rawText.trimStart().startsWith("/");
    return { allowed: !looksLikeCommand, commandAuthorized: !looksLikeCommand };
  }

  const auth = await resolveCommandAuthorization({
    core: runtime,
    cfg: params.cfg as OpenClawConfig,
    accountConfig: {
      dmPolicy: account.config.dmPolicy,
      allowFrom: account.config.allowFrom,
    },
    rawBody: params.rawText,
    senderUserId: peerId,
    normalizeAllowFrom,
  });
  return {
    allowed: auth.commandAuthorized !== false,
    commandAuthorized: auth.commandAuthorized ?? true,
  };
}

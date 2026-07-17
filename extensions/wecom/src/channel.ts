/**
 * 企业微信 OpenClaw ChannelPlugin 定义（channel）
 *
 * 实现 OpenClaw 标准通道契约：配置/安全/出站/status/gateway/actions/setup。
 * - 入站：gateway.startAccount → Bot WS（monitor）或 Webhook（webhook/index）或 Agent-only 等待
 * - 出站：优先 Bot WebSocket，失败回退 Agent HTTP API
 * - 安全：DM/群组策略；resolveDmPolicy 使用 openclaw-compat buildAccountScopedDmSecurityPolicy
 *
 * 与 message-sdk：出站分块与 Reply 预处理经 getWeComRuntime().channel 与 runtime-api 间接使用 SDK；
 * 企微协议适配保留在本插件 webhook/agent/monitor 子模块。
 */

import {
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/core";
import { buildAccountScopedDmSecurityPolicy, type ChannelSecurityDmPolicyCompat } from "./shared/openclaw-compat.js";
import type { ChannelStatusIssue } from "openclaw/plugin-sdk/channel-contract";

import { formatPairingApproveHint, DEFAULT_ACCOUNT_ID } from './shared/openclaw-compat.js'
import { getWeComRuntime } from "./runtime.js";
import { monitorWeComProvider } from "./dispatch/ws-monitor.js";
import { getWeComWebSocket } from "./state/state-manager.js";
import { wecomSetupWizard, wecomSetupAdapter } from "./onboarding.js";
import {
  resolveWecomMediaMaxBytes,
  type WeComConfig,
  type ResolvedWeComAccount,
} from "./config/wecom-config.js";
import {
  listWeComAccountIds,
  resolveWeComAccountMulti,
  resolveDefaultWeComAccountId,
  hasMultiAccounts,
} from "./config/accounts.js";
import type { WeComMultiAccountConfig } from "./config/accounts.js";
import { CHANNEL_ID, TEXT_CHUNK_LIMIT, WEBHOOK_PATHS } from "./types/const.js";
import { uploadAndSendMedia } from "./media/media-uploader.js";
import { registerAgentWebhookTarget, deregisterAgentWebhookTarget } from "./agent/webhook.js";
import { resolveWecomTarget } from "./outbound/target.js";
import { sendText as sendAgentText, sendMedia as sendAgentMedia, uploadMedia as uploadAgentMedia } from "./agent/api-client.js";
import { startWebhookGateway, stopWebhookGateway } from "./webhook/index.js";
import type { ResolvedWebhookAccount, WebhookGatewayContext } from "./webhook/index.js";
import { fetchAndSaveWecomDocMcpConfig } from "./mcp/config-fetch.js";
import { probeWeComAccount } from "./runtime/probe.js";
import {
  getExtendedMediaLocalRoots,
  readGuardedLocalMediaFile,
} from "./media/media-path-guard.js";
import { downloadGuardedHttpMedia } from "./media/http-media.js";

/**
 * 主动发送文本消息：Bot WS 优先，不可用时回退 Agent HTTP。
 *
 * @param to 目标会话（可带 wecom: 前缀）
 * @param content Markdown 正文
 * @param accountId 多账号 ID
 * @param cfg Agent 回退时必需
 */
async function sendWeComMessage({
                                  to,
                                  content,
                                  accountId,
                                  cfg,
                                }: {
  to: string;
  content: string;
  accountId?: string;
  cfg?: OpenClawConfig;
}): Promise<{ channel: string; messageId: string; chatId: string }> {
  const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;

  // 从 to 中提取目标（格式是 "${CHANNEL_ID}:xxx" 或直接是目标字符串）
  const channelPrefix = new RegExp(`^${CHANNEL_ID}:`, "i");
  const chatId = to.replace(channelPrefix, "");

  // ── 尝试 Bot WebSocket ──
  const wsClient = getWeComWebSocket(resolvedAccountId);
  if (wsClient?.isConnected) {
    const result = await wsClient.sendMessage(chatId, {
      msgtype: 'markdown',
      markdown: { content },
    });
    const messageId = result?.headers?.req_id ?? `wecom-${Date.now()}`;
    return { channel: CHANNEL_ID, messageId, chatId };
  }

  // ── 回退到 Agent HTTP API ──
  if (!cfg) {
    throw new Error(`WSClient not connected for account ${resolvedAccountId} and no config available for Agent fallback`);
  }
  const account = resolveWeComAccountMulti({ cfg, accountId: resolvedAccountId });
  const agent = account.agent;
  if (!agent?.configured) {
    throw new Error(
      `WSClient not connected for account ${resolvedAccountId} and Agent mode is not configured. ` +
      `Please configure either Bot (botId + secret) or Agent (corpId + corpSecret + agentId) for this account.`
    );
  }

  const target = resolveWecomTarget(chatId);
  if (!target) {
    throw new Error(`Cannot resolve outbound target from "${to}"`);
  }

  // 目标成员/群聊标识属于业务数据，生产日志只记录降级路径和账户，不记录收件人。
  console.log(`[wecom-outbound] Bot WS unavailable, falling back to Agent HTTP API (accountId=${resolvedAccountId})`);
  await sendAgentText({
    agent,
    toUser: target.touser,
    toParty: target.toparty,
    toTag: target.totag,
    chatId: target.chatid,
    text: content,
  });

  return {
    channel: CHANNEL_ID,
    messageId: `agent-${Date.now()}`,
    chatId,
  };
}

// 企业微信频道元数据
const meta = {
  id: CHANNEL_ID,
  label: "企业微信",
  selectionLabel: "企业微信 (WeCom)",
  detailLabel: "企业微信智能机器人",
  docsPath: `/channels/${CHANNEL_ID}`,
  docsLabel: CHANNEL_ID,
  blurb: "企业微信智能机器人接入插件",
  systemImage: "message.fill",
};

/** Bot WS、Agent API、Bot Webhook 三种接入任一完整即可视为账号已配置。 */
function isWeComAccountConfigured(account: ResolvedWeComAccount): boolean {
  return Boolean(account.botId?.trim() && account.secret?.trim()) ||
    Boolean(account.agent?.configured) ||
    Boolean(account.token?.trim() && account.encodingAESKey?.trim());
}

export const wecomPlugin: ChannelPlugin<ResolvedWeComAccount> = {
  id: CHANNEL_ID,
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  pairing: {
    idLabel: "wecomUserId",
    normalizeAllowEntry: (entry) => entry.replace(new RegExp(`^(${CHANNEL_ID}|user):`, "i"), "").trim(),
    notifyApproval: async ({ cfg, id, accountId }) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const hint = formatPairingApproveHint(CHANNEL_ID);
      await sendWeComMessage({
        to: id,
        content: hint || "✅ 配对已批准，可以开始对话。",
        accountId: resolvedAccountId,
        cfg,
      });
    },
  },
  setupWizard: wecomSetupWizard,
  setup: wecomSetupAdapter,
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: {configPrefixes: [`channels.${CHANNEL_ID}`]},
  config: {
    // 多账号：列出所有账户 ID
    listAccountIds: (cfg) => listWeComAccountIds(cfg),

    // 多账号：按 accountId 解析账户配置
    resolveAccount: (cfg, accountId) => resolveWeComAccountMulti({ cfg, accountId }),

    // 多账号：获取默认账户 ID
    defaultAccountId: (cfg) => resolveDefaultWeComAccountId(cfg),

    // 多账号：设置账户启用状态
    setAccountEnabled: ({cfg, accountId, enabled}) => {
      if (!hasMultiAccounts(cfg)) {
        // 单账号模式：设置顶层 enabled
        const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            [CHANNEL_ID]: {
              ...wecomConfig,
              enabled,
            },
          },
        };
      }
      // 多账号模式：设置 accounts[accountId].enabled
      const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComMultiAccountConfig;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [CHANNEL_ID]: {
            ...wecomConfig,
            accounts: {
              ...wecomConfig.accounts,
              [accountId]: {
                ...wecomConfig.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      };
    },

    // 多账号：删除账户
    deleteAccount: ({cfg, accountId}) => {
      if (!hasMultiAccounts(cfg)) {
        // 单账号模式：删除整个 wecom 配置
        const next = { ...cfg } as OpenClawConfig;
        const nextChannels = { ...cfg.channels };
        delete (nextChannels as Record<string, unknown>)[CHANNEL_ID];
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }

      // 删除指定账号
      const wecomConfig = cfg.channels?.[CHANNEL_ID] as WeComMultiAccountConfig | undefined;
      const accounts = { ...wecomConfig?.accounts };
      delete accounts[accountId];

      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          [CHANNEL_ID]: {
            ...wecomConfig,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },

    // 检查是否已配置（Bot / Agent / botWebhook 凭证之一即可）
    isConfigured: isWeComAccountConfigured,

    // 描述账户信息
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: isWeComAccountConfigured(account),
      botId: account.botId,
      websocketUrl: account.websocketUrl,
      agentConfigured: Boolean(account.agent?.configured),
    }),

    // 解析允许来源列表（多账号：按 accountId 解析）
    resolveAllowFrom: ({cfg, accountId}) => {
      const account = resolveWeComAccountMulti({ cfg, accountId });
      return (account.config.allowFrom ?? []).map((entry) => String(entry));
    },

    // 格式化允许来源列表
    formatAllowFrom: ({allowFrom}) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean),
  },
  security: {
    resolveDmPolicy: ({cfg, accountId, account}) => {
      const result = buildAccountScopedDmSecurityPolicy({
        cfg,
        channelKey: CHANNEL_ID,
        accountId,
        fallbackAccountId: account.accountId,
        policy: account.config.dmPolicy,
        allowFrom: account.config.allowFrom ?? [],
        defaultPolicy: "open",
        policyPathSuffix: "dmPolicy",
        approveHint: formatPairingApproveHint(CHANNEL_ID),
        normalizeEntry: (raw) => raw.replace(new RegExp(`^${CHANNEL_ID}:`, "i"), "").trim(),
      });
      return result as ChannelSecurityDmPolicyCompat;
    },
    collectWarnings: ({cfg, accountId}) => {
      const account = resolveWeComAccountMulti({ cfg, accountId });
      const warnings: string[] = [];

      // 动态构造配置路径（区分单账号 / 多账号）
      const isMulti = hasMultiAccounts(cfg);
      const basePath = isMulti && accountId
        ? `channels.${CHANNEL_ID}.accounts.${accountId}.`
        : `channels.${CHANNEL_ID}.`;

      // DM 策略警告
      const dmPolicy = account.config.dmPolicy ?? "open";
      if (dmPolicy === "open") {
        const hasWildcard = (account.config.allowFrom ?? []).some(
          (entry) => String(entry).trim() === "*"
        );
        if (!hasWildcard) {
          warnings.push(
            `- 企业微信[${account.accountId}]私信：dmPolicy="open" 但 allowFrom 未包含 "*"。任何人都可以发消息，但允许列表为空可能导致意外行为。建议设置 ${basePath}allowFrom=["*"] 或使用 dmPolicy="pairing"。`,
          );
        }
      }

      // 群组策略警告
      const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
      const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "open";
      if (groupPolicy === "open") {
        warnings.push(
          `- 企业微信[${account.accountId}]群组：groupPolicy="open" 允许所有群组中的成员触发。设置 ${basePath}groupPolicy="allowlist" + ${basePath}groupAllowFrom 来限制群组。`,
        );
      }

      return warnings;
    },
  },
  messaging: {
    normalizeTarget: (target) => {
      const trimmed = target.trim();
      if (!trimmed) return undefined;
      return trimmed;
    },
    targetResolver: {
      looksLikeId: (id) => {
        const trimmed = id?.trim();
        return Boolean(trimmed);
      },
      hint: "<userId|groupId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  outbound: {
    deliveryMode: "gateway",
    chunker: (text, limit) => getWeComRuntime().channel.text.chunkMarkdownText(text, limit),
    textChunkLimit: TEXT_CHUNK_LIMIT,
    sendText: async ({to, text, accountId, cfg}) => {
      return sendWeComMessage({to, content: text, accountId: accountId ?? undefined, cfg});
    },
    sendMedia: async ({to, text, mediaUrl, mediaLocalRoots, accountId, cfg}) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const channelPrefix = new RegExp(`^${CHANNEL_ID}:`, "i");
      const chatId = to.replace(channelPrefix, "");

      // 如果没有 mediaUrl，fallback 为纯文本
      if (!mediaUrl) {
        return sendWeComMessage({to, content: text || "", accountId: resolvedAccountId, cfg});
      }

      // ── 尝试 Bot WebSocket ──
      const wsClient = getWeComWebSocket(resolvedAccountId);
      if (wsClient?.isConnected) {
        const result = await uploadAndSendMedia({
          wsClient,
          mediaUrl,
          chatId,
          mediaLocalRoots,
        });

        if (result.rejected) {
          return sendWeComMessage({to, content: `⚠️ ${result.rejectReason}`, accountId: resolvedAccountId, cfg});
        }

        if (!result.ok) {
          const fallbackContent = text
            ? `${text}\n📎 ${mediaUrl}`
            : `📎 ${mediaUrl}`;
          return sendWeComMessage({to, content: fallbackContent, accountId: resolvedAccountId, cfg});
        }

        if (text) {
          await sendWeComMessage({to, content: text, accountId: resolvedAccountId, cfg});
        }
        if (result.downgradeNote) {
          await sendWeComMessage({to, content: `ℹ️ ${result.downgradeNote}`, accountId: resolvedAccountId, cfg});
        }

        return {
          channel: CHANNEL_ID,
          messageId: result.messageId!,
          chatId,
        };
      }

      // ── 回退到 Agent HTTP API ──
      if (!cfg) {
        throw new Error(`WSClient not connected for account ${resolvedAccountId} and no config available for Agent fallback`);
      }
      const account = resolveWeComAccountMulti({ cfg, accountId: resolvedAccountId });
      const agent = account.agent;
      if (!agent?.configured) {
        throw new Error(
          `WSClient not connected for account ${resolvedAccountId} and Agent mode is not configured. ` +
          `Please configure either Bot (botId + secret) or Agent (corpId + corpSecret + agentId).`
        );
      }

      // Agent 模式：文本 fallback（Agent HTTP API 不支持直接发 mediaUrl，需先上传）
      const target = resolveWecomTarget(chatId);
      if (!target) {
        throw new Error(`Cannot resolve outbound target from "${to}"`);
      }

      // 与文本降级保持同一脱敏策略，避免媒体发送日志泄露成员或群聊标识。
      console.log(`[wecom-outbound] Bot WS unavailable, sending media via Agent HTTP API (accountId=${account.accountId})`);

      // 尝试下载并上传媒体到企微。远程 URL 必须经过 SSRF Guard，本地文件必须经过
      // Path Guard；两条路径共用 media.maxBytes，不能让出站工具成为内网探测或任意读文件入口。
      try {
        const maxBytes = resolveWecomMediaMaxBytes(cfg);
        const isRemote = /^https?:\/\//i.test(mediaUrl);
        let buffer: Buffer;
        let contentType = "";
        if (isRemote) {
          const downloaded = await downloadGuardedHttpMedia({
            url: mediaUrl,
            maxBytes,
            timeoutMs: 30_000,
          });
          buffer = downloaded.buffer;
          contentType = downloaded.contentType;
        } else {
          const local = await readGuardedLocalMediaFile({
            filePath: mediaUrl,
            allowedRoots: await getExtendedMediaLocalRoots(account.config),
            maxBytes,
          });
          if (!local.ok) throw new Error(local.error);
          buffer = local.buffer;
        }

        const filename = mediaUrl.split(/[\\/]/).pop()?.split("?")[0] || "file.bin";
        const mediaType = contentType.startsWith("image/")
          ? "image"
          : contentType.startsWith("audio/")
            ? "voice"
            : contentType.startsWith("video/")
              ? "video"
              : "file";
        const mediaId = await uploadAgentMedia({ agent, type: mediaType, buffer, filename });
        await sendAgentMedia({
          agent,
          toUser: target.touser,
          toParty: target.toparty,
          toTag: target.totag,
          chatId: target.chatid,
          mediaId,
          mediaType,
          ...(mediaType === "video" ? { title: filename, description: "" } : {}),
        });
        if (text) {
          await sendAgentText({ agent, toUser: target.touser, toParty: target.toparty, toTag: target.totag, chatId: target.chatid, text });
        }
        return { channel: CHANNEL_ID, messageId: `agent-media-${Date.now()}`, chatId };
      } catch {
        // 降级会显式携带原 URL/路径，调用方仍能看到附件未真正上传；不要把凭据相关的
        // SDK/网络错误原文拼进对外消息。
      }

      // 媒体上传失败，降级为文本 + URL
      const fallbackContent = text ? `${text}\n📎 ${mediaUrl}` : `📎 ${mediaUrl}`;
      await sendAgentText({ agent, toUser: target.touser, toParty: target.toparty, toTag: target.totag, chatId: target.chatid, text: fallbackContent });
      return { channel: CHANNEL_ID, messageId: `agent-${Date.now()}`, chatId };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts): ChannelStatusIssue[] =>
      accounts.flatMap((entry) => {
        const accountId = String(entry.accountId ?? DEFAULT_ACCOUNT_ID);
        const enabled = entry.enabled !== false;
        const configured = entry.configured === true;
        if (!enabled) {
          return [];
        }
        const issues: ChannelStatusIssue[] = [];
        if (!configured) {
          issues.push({
            channel: CHANNEL_ID,
            accountId,
            kind: "config",
            message: "企业微信机器人 ID 或 Secret 未配置",
            fix: "Run: openclaw channels add wecom --bot-id <id> --secret <secret>",
          });
        }
        return issues;
      }),
    buildChannelSummary: ({snapshot}) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
    probeAccount: async ({ account }) => {
      return probeWeComAccount(account);
    },
    buildAccountSnapshot: ({account, runtime}) => {
      const configured = isWeComAccountConfigured(account);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
      };
    },
  },

  // ==========================================================================
  // Message Tool Actions (OpenClaw standard contract)
  // ==========================================================================
  actions: {
    describeMessageTool: () => ({
      actions: ["send", "sendAttachment"] as const,
      capabilities: [] as const,
      schema: {
        properties: {
          media: { type: "string", description: "Media file URL or local file path (for file/image/audio/video attachments)" },
          caption: { type: "string", description: "Optional caption text for the media" },
        },
        visibility: "current-channel",
      },
    } as const),

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- AgentToolResult shape compatible
    handleAction: (async (ctx: Record<string, unknown>) => {
      const action = String(ctx.action ?? "");
      const params = (ctx.params ?? {}) as Record<string, unknown>;
      const cfg = ctx.cfg as OpenClawConfig | undefined;
      const accountId = (ctx.accountId ?? undefined) as string | undefined;

      const to = String(params.to ?? "").trim();
      if (!to) {
        return { content: [], details: { ok: false, error: "wecom send requires 'to' param" } };
      }

      if (action === "send") {
        const message = String(params.message ?? "");
        const media = String(params.media ?? "").trim();
        if (media) {
          const wsClient = getWeComWebSocket(accountId ?? DEFAULT_ACCOUNT_ID);
          if (!wsClient?.isConnected) throw new Error("wecom media action requires an active Bot WebSocket connection");
          const chatId = to.replace(new RegExp(`^${CHANNEL_ID}:`, "i"), "");
          const delivered = await uploadAndSendMedia({ wsClient, mediaUrl: media, chatId });
          if (!delivered.ok || delivered.rejected || !delivered.messageId) {
            throw new Error(delivered.rejectReason ?? "wecom media delivery failed");
          }
          if (message) await sendWeComMessage({ to, content: message, accountId, cfg });
          return { content: [{ type: "text" as const, text: message || `Sent ${media}` }], details: { ok: true, messageId: delivered.messageId } };
        }
        const result = await sendWeComMessage({ to, content: message, accountId, cfg });
        return { content: [{ type: "text" as const, text: message }], details: { ok: true, messageId: result.messageId } };
      }

      if (action === "sendAttachment") {
        const media = String(params.media ?? "").trim();
        if (!media) {
          return { content: [], details: { ok: false, error: "wecom sendAttachment requires 'media' param" } };
        }
        const caption = String(params.caption ?? "").trim();
        const wsClient = getWeComWebSocket(accountId ?? DEFAULT_ACCOUNT_ID);
        if (!wsClient?.isConnected) throw new Error("wecom sendAttachment requires an active Bot WebSocket connection");
        const chatId = to.replace(new RegExp(`^${CHANNEL_ID}:`, "i"), "");
        const delivered = await uploadAndSendMedia({ wsClient, mediaUrl: media, chatId });
        if (!delivered.ok || delivered.rejected || !delivered.messageId) {
          throw new Error(delivered.rejectReason ?? "wecom attachment delivery failed");
        }
        if (caption) await sendWeComMessage({ to, content: caption, accountId, cfg });
        return { content: [{ type: "text" as const, text: caption || `Attachment: ${media}` }], details: { ok: true, messageId: delivered.messageId } };
      }

      return { content: [], details: { ok: false, error: `Unsupported wecom action: ${action}` } };
    }) as any,
  },

  gateway: {
    /**
     * 按账号启动网关：注册 Agent webhook 目标、Bot WS 监听或 Bot Webhook gateway。
     * connectionMode 默认 websocket；配置 token+encodingAESKey 可走 webhook。
     */
    startAccount: async (ctx) => {
      // 多账号：按 accountId 解析账号配置
      const account = resolveWeComAccountMulti({ cfg: ctx.cfg, accountId: ctx.accountId });

      // 读取连接模式（默认 websocket）
      const connectionMode = account.config.connectionMode ?? "websocket";

      ctx.log?.info(
        `starting wecom[${ctx.accountId}] (name: ${account.name}, mode: ${connectionMode})`,
      );

      // ── Agent target 注册 ──────────────────────────────────────────
      const agent = account.agent;
      if (agent?.configured) {
        // 配置热重载可能在旧 abort 回调到达前启动新实例；先清掉同账号旧目标，避免重复分发。
        deregisterAgentWebhookTarget(agent.accountId);
        const isMulti = hasMultiAccounts(ctx.cfg);
        const defaultId = resolveDefaultWeComAccountId(ctx.cfg);
        const isDefault = ctx.accountId === defaultId;
        const paths = isMulti
          ? [
              `${WEBHOOK_PATHS.AGENT_PLUGIN}/${ctx.accountId}`,
              `${WEBHOOK_PATHS.AGENT}/${ctx.accountId}`,
              // 默认账号额外注册 /default 别名路径
              ...(isDefault && ctx.accountId !== DEFAULT_ACCOUNT_ID
                ? [
                    `${WEBHOOK_PATHS.AGENT_PLUGIN}/${DEFAULT_ACCOUNT_ID}`,
                    `${WEBHOOK_PATHS.AGENT}/${DEFAULT_ACCOUNT_ID}`,
                  ]
                : []),
              WEBHOOK_PATHS.AGENT_PLUGIN,
              WEBHOOK_PATHS.AGENT,
            ]
          : [
              // 单账号模式：同时注册 /default 路径以支持显式指定
              WEBHOOK_PATHS.AGENT_PLUGIN,
              WEBHOOK_PATHS.AGENT,
              `${WEBHOOK_PATHS.AGENT_PLUGIN}/${DEFAULT_ACCOUNT_ID}`,
              `${WEBHOOK_PATHS.AGENT}/${DEFAULT_ACCOUNT_ID}`,
            ];

        const unregisterTargets = paths.map((p) =>
          registerAgentWebhookTarget({
            agent,
            config: ctx.cfg,
            runtime: {
              log: ctx.log?.info ? (msg: string) => ctx.log!.info(msg) : undefined,
              error: ctx.log?.error ? (msg: string) => ctx.log!.error(msg) : undefined,
            },
            path: p,
          }),
        );
        ctx.log?.info(`[${ctx.accountId}] wecom agent webhook registered at ${paths.join(", ")}`);

        // 账号生命周期结束时清理
        ctx.abortSignal.addEventListener("abort", () => {
          for (const unregister of unregisterTargets) unregister();
        }, { once: true });
      }

      

      // ── Bot WebSocket 监听（需要 botId + secret）──────────────────
      const hasBotCredentials = Boolean(account.botId?.trim() && account.secret?.trim());
      if (hasBotCredentials) {
        // Fire-and-forget: fetch and save WeCom doc MCP config after WS client is authenticated
        const acctId = ctx.accountId;
        let mcpFetchAttempts = 0;
        const mcpFetchTimer = setInterval(() => {
          mcpFetchAttempts += 1;
          const ws = getWeComWebSocket(acctId);
          if (ws?.isConnected) {
            clearInterval(mcpFetchTimer);
            fetchAndSaveWecomDocMcpConfig({
              client: ws,
              accountId: acctId,
              runtime: {
                log: (msg) => ctx.log?.info?.(msg),
                error: (msg) => ctx.log?.error?.(msg),
              },
            }).catch((err: unknown) => {
              ctx.log?.error?.(`[wecom] MCP config fetch failed: ${String(err)}`);
            });
          } else if (mcpFetchAttempts >= 60) {
            clearInterval(mcpFetchTimer);
            ctx.log?.warn?.("[wecom] MCP config fetch skipped: WebSocket was not ready within 60 seconds");
          }
        }, 1000);
        mcpFetchTimer.unref();
        ctx.abortSignal?.addEventListener("abort", () => clearInterval(mcpFetchTimer), { once: true });

        return monitorWeComProvider({
          account,
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- SDK 类型签名在不同版本间存在差异
          setStatus: ctx.setStatus as any,
        });
      } else if (connectionMode === "webhook") {
        // ── Webhook 模式 ──────────────────────────────────────────────
        const webhookAccount: ResolvedWebhookAccount = {
          ...account,
          connectionMode: "webhook",
          token: account.config.token ?? "",
          encodingAESKey: account.config.encodingAESKey ?? "",
          receiveId: account.config.receiveId ?? "",
          welcomeText: account.config.welcomeText,
        };

        const gatewayCtx: WebhookGatewayContext = {
          account: webhookAccount,
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          setStatus: ctx.setStatus as any,
          log: ctx.log,
          accountId: ctx.accountId,
        };

        startWebhookGateway(gatewayCtx);

        // 等待 abortSignal 停止后清理
        await new Promise<void>((resolve) => {
          if (ctx.abortSignal.aborted) {
            stopWebhookGateway(gatewayCtx);
            resolve();
            return;
          }
          ctx.abortSignal.addEventListener("abort", () => {
            stopWebhookGateway(gatewayCtx);
            resolve();
          }, { once: true });
        });
        return;
      }

      // Agent-only：无 Bot，等待 abort 信号
      return new Promise<void>((resolve) => {
        if (ctx.abortSignal.aborted) {
          resolve();
          return;
        }
        ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });
    },
    logoutAccount: async ({cfg, accountId}) => {
      const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
      const isMulti = hasMultiAccounts(cfg);
      let nextCfg = {...cfg} as OpenClawConfig;
      let cleared = false;
      let changed = false;

      if (!isMulti) {
        // 单账号模式：删除顶层 botId/secret
        const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComConfig;
        const nextWecom = {...wecomConfig};

        if (nextWecom.botId || nextWecom.secret) {
          delete nextWecom.botId;
          delete nextWecom.secret;
          cleared = true;
          changed = true;
        }

        if (changed) {
          if (Object.keys(nextWecom).length > 0) {
            nextCfg.channels = {...nextCfg.channels, [CHANNEL_ID]: nextWecom};
          } else {
            const nextChannels = {...nextCfg.channels};
            delete (nextChannels as Record<string, unknown>)[CHANNEL_ID];
            if (Object.keys(nextChannels).length > 0) {
              nextCfg.channels = nextChannels;
            } else {
              delete nextCfg.channels;
            }
          }
        }
      } else {
        // 多账号模式：删除指定账号的 botId/secret
        const wecomConfig = (cfg.channels?.[CHANNEL_ID] ?? {}) as WeComMultiAccountConfig;
        const accountCfg = wecomConfig.accounts?.[resolvedAccountId];

        if (accountCfg?.botId || accountCfg?.secret) {
          const nextAccount = {...accountCfg};
          delete nextAccount.botId;
          delete nextAccount.secret;
          cleared = true;
          changed = true;

          const nextAccounts = { ...wecomConfig.accounts };
          if (Object.keys(nextAccount).length > 0) {
            nextAccounts[resolvedAccountId] = nextAccount;
          } else {
            delete nextAccounts[resolvedAccountId];
          }

          nextCfg = {
            ...cfg,
            channels: {
              ...cfg.channels,
              [CHANNEL_ID]: {
                ...wecomConfig,
                accounts: Object.keys(nextAccounts).length > 0 ? nextAccounts : undefined,
              },
            },
          } as OpenClawConfig;
        }
      }

      if (changed) {
        await getWeComRuntime().config.writeConfigFile(nextCfg);
      }

      const resolved = resolveWeComAccountMulti({ cfg: changed ? nextCfg : cfg, accountId: resolvedAccountId });
      const loggedOut = !resolved.botId && !resolved.secret;

      return {cleared, envToken: false, loggedOut};
    },
  },
};

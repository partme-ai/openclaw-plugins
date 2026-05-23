/**
 * 企业微信 setupWizard — 声明式 CLI setup wizard 配置。
 *
 * 覆盖 Bot 双模式（WebSocket / Webhook）+ Agent 模式 + 多账号。
 * 框架通过 plugin.setupWizard 字段识别并驱动 channel 的引导配置流程。
 */

import type { ChannelSetupWizard, ChannelSetupDmPolicy } from "openclaw/plugin-sdk/setup";
import type { ChannelSetupAdapter } from "openclaw/plugin-sdk/setup";
import type { OpenClawConfig } from "openclaw/plugin-sdk/core";
import { addWildcardAllowFrom } from "./openclaw-compat.js";
import type { WeComConfig } from "./utils.js";
import { resolveWeComAccountMulti, setWeComAccountMulti, hasMultiAccounts, listWeComAccountIds } from "./accounts.js";
import { CHANNEL_ID } from "./const.js";

// ============================================================================
// Helpers
// ============================================================================

function getAccount(cfg: OpenClawConfig, accountId?: string) {
  return resolveWeComAccountMulti({ cfg, accountId: accountId ?? null });
}

function isConfigured(cfg: OpenClawConfig, accountId?: string): boolean {
  const a = getAccount(cfg, accountId);
  const hasBotWs = Boolean(a.botId?.trim() && a.secret?.trim());
  const hasBotWebhook = Boolean(a.token?.trim() && a.encodingAESKey?.trim());
  const hasAgent = Boolean(a.agent?.configured);
  return hasBotWs || hasBotWebhook || hasAgent;
}

// ============================================================================
// ChannelSetupAdapter — 框架用于应用配置输入的适配器
// ============================================================================

export const wecomSetupAdapter: ChannelSetupAdapter = {
  applyAccountConfig: ({ cfg, input, accountId }) => {
    const patch: Partial<WeComConfig> = {};

    // Bot WebSocket 凭据
    if (input.token !== undefined) patch.botId = String(input.token).trim();
    if (input.privateKey !== undefined) patch.secret = String(input.privateKey).trim();

    // Bot Webhook 凭据
    if (input.webhookUrl !== undefined) patch.token = String(input.webhookUrl).trim();
    if (input.password !== undefined) patch.encodingAESKey = String(input.password).trim();
    if (input.accessToken !== undefined) patch.receiveId = String(input.accessToken).trim() || undefined;

    // Agent 凭据（通过 ChannelSetupInput 的其他字段承载）
    const agentPatch: Record<string, unknown> = {};
    if (input.secret !== undefined) agentPatch.corpSecret = String(input.secret).trim();
    if (input.botToken !== undefined) agentPatch.token = String(input.botToken).trim();
    if (input.appToken !== undefined) agentPatch.encodingAESKey = String(input.appToken).trim();
    if (input.userId !== undefined) agentPatch.corpId = String(input.userId).trim();
    if (input.webhookPath !== undefined) agentPatch.agentId = String(input.webhookPath).trim();
    if (Object.keys(agentPatch).length > 0) {
      const existing = getAccount(cfg, accountId).config.agent ?? {};
      patch.agent = { ...existing, ...agentPatch } as any;
    }

    if (!isConfigured(cfg, accountId)) {
      patch.enabled = true;
    }

    return setWeComAccountMulti(cfg, patch, accountId);
  },
};

// ============================================================================
// DM Policy 配置
// ============================================================================

function setWeComDmPolicy(
  cfg: OpenClawConfig,
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled",
  accountId?: string,
): OpenClawConfig {
  const account = getAccount(cfg, accountId);
  const existingAllowFrom = account.config.allowFrom ?? [];
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(existingAllowFrom.map((x) => String(x)))
      : existingAllowFrom.map((x) => String(x));
  return setWeComAccountMulti(cfg, { dmPolicy, allowFrom }, accountId);
}

const dmPolicy: ChannelSetupDmPolicy = {
  label: "企业微信",
  channel: CHANNEL_ID,
  policyKey: `channels.${CHANNEL_ID}.dmPolicy`,
  allowFromKey: `channels.${CHANNEL_ID}.allowFrom`,
  getCurrent: (cfg, accountId) => getAccount(cfg, accountId).config.dmPolicy ?? "open",
  setPolicy: (cfg, policy, accountId) => setWeComDmPolicy(cfg, policy as any, accountId),
  promptAllowFrom: async ({ cfg, prompter, accountId }) => {
    const account = getAccount(cfg, accountId);
    const existingAllowFrom = account.config.allowFrom ?? [];
    const entry = await prompter.text({
      message: "企业微信允许来源（用户ID或群组ID，逗号分隔）",
      placeholder: "user123, group456",
      initialValue: existingAllowFrom[0] ? String(existingAllowFrom[0]) : undefined,
    });
    const allowFrom = String(entry ?? "").split(/[\n,;]+/g).map((s) => s.trim()).filter(Boolean);
    return setWeComAccountMulti(cfg, { allowFrom }, accountId);
  },
};

// ============================================================================
// Bot 凭据
// ============================================================================

const BOT_CREDENTIALS: ChannelSetupWizard["credentials"] = [
  {
    inputKey: "token" as const,
    providerHint: "企业微信",
    credentialLabel: "Bot ID",
    envPrompt: "使用环境变量中的 Bot ID？",
    keepPrompt: "Bot ID 已配置，保留当前值？",
    inputPrompt: "企业微信机器人 Bot ID",
    inspect: ({ cfg, accountId }) => {
      const hasValue = Boolean(getAccount(cfg, accountId).botId?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: getAccount(cfg, accountId).botId || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => setWeComAccountMulti(cfg, { botId: resolvedValue }, accountId),
  },
  {
    inputKey: "privateKey" as const,
    providerHint: "企业微信",
    credentialLabel: "Bot Secret",
    envPrompt: "使用环境变量中的 Bot Secret？",
    keepPrompt: "Bot Secret 已配置，保留当前值？",
    inputPrompt: "企业微信机器人 Secret",
    inspect: ({ cfg, accountId }) => {
      const hasValue = Boolean(getAccount(cfg, accountId).secret?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: getAccount(cfg, accountId).secret || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => setWeComAccountMulti(cfg, { secret: resolvedValue }, accountId),
  },
];

// ============================================================================
// Agent 凭据 — 复用 ChannelSetupInput 中的字段承载 Agent 特有字段
// ============================================================================

const AGENT_CREDENTIALS: ChannelSetupWizard["credentials"] = [
  {
    inputKey: "userId" as const,
    providerHint: "企业微信 Agent",
    credentialLabel: "Agent CorpID",
    envPrompt: "使用环境变量中的 CorpID？",
    keepPrompt: "Agent CorpID 已配置，保留当前值？",
    inputPrompt: "企业 CorpID (ww...)",
    helpTitle: "Agent 模式：企业 CorpID",
    helpLines: ["企业微信管理后台 → 我的企业 → 企业信息 → 企业 ID"],
    inspect: ({ cfg, accountId }) => {
      const agent = getAccount(cfg, accountId).agent;
      const hasValue = Boolean(agent?.corpId?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: agent?.corpId || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => {
      const agent = getAccount(cfg, accountId).agent ?? {};
      return setWeComAccountMulti(cfg, { agent: { ...agent, corpId: resolvedValue } as any }, accountId);
    },
  },
  {
    inputKey: "secret" as const,
    providerHint: "企业微信 Agent",
    credentialLabel: "Agent CorpSecret",
    envPrompt: "使用环境变量中的 CorpSecret？",
    keepPrompt: "Agent CorpSecret 已配置，保留当前值？",
    inputPrompt: "自建应用 CorpSecret",
    helpTitle: "Agent 模式：应用 Secret",
    helpLines: ["企业微信管理后台 → 应用管理 → 自建应用 → Secret"],
    inspect: ({ cfg, accountId }) => {
      const agent = getAccount(cfg, accountId).agent;
      const hasValue = Boolean(agent?.corpSecret?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: agent?.corpSecret || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => {
      const agent = getAccount(cfg, accountId).agent ?? {};
      return setWeComAccountMulti(cfg, { agent: { ...agent, corpSecret: resolvedValue } as any }, accountId);
    },
  },
  {
    inputKey: "webhookPath" as const,
    providerHint: "企业微信 Agent",
    credentialLabel: "Agent ID",
    envPrompt: "使用环境变量中的 AgentId？",
    keepPrompt: "Agent ID 已配置，保留当前值？",
    inputPrompt: "自建应用 AgentId（可选）",
    helpTitle: "Agent 模式：应用 ID",
    helpLines: ["企业微信管理后台 → 应用管理 → 自建应用 → AgentId", "可选：不填仍可接收回调，主动发送消息时需填写"],
    inspect: ({ cfg, accountId }) => {
      const agentId = getAccount(cfg, accountId).agent?.agentId;
      const hasValue = agentId !== undefined && agentId !== null;
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: hasValue ? String(agentId) : undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => {
      const agent = getAccount(cfg, accountId).agent ?? {};
      const agentId = resolvedValue ? (/^\d+$/.test(resolvedValue) ? Number(resolvedValue) : resolvedValue) : undefined;
      return setWeComAccountMulti(cfg, { agent: { ...agent, agentId } as any }, accountId);
    },
  },
  {
    inputKey: "botToken" as const,
    providerHint: "企业微信 Agent",
    credentialLabel: "Agent 回调 Token",
    envPrompt: "使用环境变量中的回调 Token？",
    keepPrompt: "Agent 回调 Token 已配置，保留当前值？",
    inputPrompt: "回调验证 Token",
    helpTitle: "Agent 模式：回调 Token",
    helpLines: ["自建应用 → 接收消息 → 设置API接收 → Token", "与 EncodingAESKey 一起在企微后台配置"],
    inspect: ({ cfg, accountId }) => {
      const agent = getAccount(cfg, accountId).agent;
      const hasValue = Boolean(agent?.token?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: agent?.token || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => {
      const agent = getAccount(cfg, accountId).agent ?? {};
      return setWeComAccountMulti(cfg, { agent: { ...agent, token: resolvedValue } as any }, accountId);
    },
  },
  {
    inputKey: "appToken" as const,
    providerHint: "企业微信 Agent",
    credentialLabel: "Agent EncodingAESKey",
    envPrompt: "使用环境变量中的 EncodingAESKey？",
    keepPrompt: "Agent EncodingAESKey 已配置，保留当前值？",
    inputPrompt: "回调加密密钥 (43位 Base64)",
    helpTitle: "Agent 模式：回调加密密钥",
    helpLines: ["与回调 Token 在同一页面生成", "长度必须为 43 个字符"],
    inspect: ({ cfg, accountId }) => {
      const agent = getAccount(cfg, accountId).agent;
      const hasValue = Boolean(agent?.encodingAESKey?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: agent?.encodingAESKey || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => {
      const agent = getAccount(cfg, accountId).agent ?? {};
      return setWeComAccountMulti(cfg, { agent: { ...agent, encodingAESKey: resolvedValue } as any }, accountId);
    },
  },
];

// ============================================================================
// Bot Webhook 凭据 — 替代 WebSocket 的回调方式
// ============================================================================

const WEBHOOK_CREDENTIALS: ChannelSetupWizard["credentials"] = [
  {
    inputKey: "webhookUrl" as const,
    providerHint: "企业微信 Bot Webhook",
    credentialLabel: "Webhook Token",
    envPrompt: "使用环境变量中的 Webhook Token？",
    keepPrompt: "Webhook Token 已配置，保留当前值？",
    inputPrompt: "Bot Webhook 回调 Token",
    helpTitle: "Bot Webhook 模式",
    helpLines: [
      "替代 WebSocket 的回调方式，需要公网服务器。",
      "在企微智能机器人 →「接收消息」设置中生成。",
      "留空则默认使用 WebSocket 模式。",
    ],
    inspect: ({ cfg, accountId }) => {
      const hasValue = Boolean(getAccount(cfg, accountId).token?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: getAccount(cfg, accountId).token || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) => {
      const mode = resolvedValue ? "webhook" : undefined;
      return setWeComAccountMulti(cfg, { token: resolvedValue, ...(mode ? { connectionMode: mode as any } : {}) }, accountId);
    },
  },
  {
    inputKey: "password" as const,
    providerHint: "企业微信 Bot Webhook",
    credentialLabel: "Encoding AES Key",
    envPrompt: "使用环境变量中的 EncodingAESKey？",
    keepPrompt: "Encoding AES Key 已配置，保留当前值？",
    inputPrompt: "回调加密密钥 (43位 Base64)",
    helpTitle: "Bot Webhook AES Key",
    helpLines: ["与 Webhook Token 一起在企微后台生成。", "长度必须为 43 个字符。"],
    inspect: ({ cfg, accountId }) => {
      const hasValue = Boolean(getAccount(cfg, accountId).encodingAESKey?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: getAccount(cfg, accountId).encodingAESKey || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) =>
      setWeComAccountMulti(cfg, { encodingAESKey: resolvedValue }, accountId),
  },
  {
    inputKey: "accessToken" as const,
    providerHint: "企业微信 Bot Webhook",
    credentialLabel: "Receive ID（可选）",
    envPrompt: "使用环境变量中的 Receive ID？",
    keepPrompt: "Receive ID 已配置，保留当前值？",
    inputPrompt: "Receive ID（可选，用于解密校验）",
    helpTitle: "Bot Webhook Receive ID",
    helpLines: ["可选字段。用于解密时校验接收者身份。", "如不确定请留空。"],
    inspect: ({ cfg, accountId }) => {
      const val = getAccount(cfg, accountId).receiveId;
      const hasValue = Boolean(val?.trim());
      return { accountConfigured: hasValue, hasConfiguredValue: hasValue, resolvedValue: val || undefined };
    },
    applySet: ({ cfg, resolvedValue, accountId }) =>
      setWeComAccountMulti(cfg, { receiveId: resolvedValue || undefined }, accountId),
  },
];

// ============================================================================
// ChannelSetupWizard
// ============================================================================

export const wecomSetupWizard: ChannelSetupWizard = {
  channel: CHANNEL_ID,

  // ── 多账号 ──────────────────────────────────────────────────────────────
  resolveAccountIdForConfigure: async ({ cfg, prompter, options, shouldPromptAccountIds, listAccountIds, defaultAccountId }) => {
    const ids = listAccountIds(cfg);
    if (!shouldPromptAccountIds || ids.length <= 1 || options?.quickstartDefaults) return defaultAccountId;
    const choice = await prompter.select({
      message: "选择要配置的企业微信账号",
      options: ids.map((id) => ({ value: id, label: id === defaultAccountId ? `${id} (默认)` : id })),
    });
    return choice ?? defaultAccountId;
  },

  resolveShouldPromptAccountIds: ({ shouldPromptAccountIds }) => shouldPromptAccountIds,

  // ── 状态 ──────────────────────────────────────────────────────────────
  status: {
    configuredLabel: "已配置 ✓",
    unconfiguredLabel: "需要 Bot 或 Agent 凭据",
    configuredHint: "已配置",
    unconfiguredHint: "需要设置",
    resolveConfigured: ({ cfg, accountId }) => isConfigured(cfg, accountId),
    resolveStatusLines: ({ cfg, configured, accountId }) => {
      const a = getAccount(cfg, accountId);
      const modes: string[] = [];
      if (a.botId?.trim() && a.secret?.trim()) modes.push("Bot-WS");
      if (a.token?.trim() && a.encodingAESKey?.trim()) modes.push("Bot-Webhook");
      if (a.agent?.configured) modes.push("Agent");
      return [`企业微信: ${configured ? modes.join("+") + " 已配置" : "需要 Bot 或 Agent 凭据"}`];
    },
  },

  // ── 引导说明 ──────────────────────────────────────────────────────────
  introNote: {
    title: "企业微信设置",
    lines: [
      "Bot WebSocket 模式（推荐，无需公网IP）：Bot ID + Secret",
      "Bot Webhook 模式（需公网IP）：Token + EncodingAESKey + ReceiveID",
      "Agent 模式（需公网IP）：CorpID + CorpSecret + AgentID + Token + AESKey",
      "",
      "三种模式可独立或组合使用，仅需填写你要使用的模式即可。",
      "",
      "流式体验（可选，openclaw config set）：",
      "  channels.wecom.streaming false   — 默认：状态栏 + 最终整包",
      "  channels.wecom.streaming true    — 打字机 / tool 进度",
      "  channels.wecom.footer.status     — 状态栏阶段文案",
      "  channels.wecom.footer.elapsed    — 关流展示耗时",
      "",
      "文案模板（可选，openclaw config set）：",
      '  channels.wecom.templates.thinking "正在思考…"',
      '  channels.wecom.templates.tool "正在查资料…"',
      '  channels.wecom.templates.compaction "📦 正在压缩上下文…"',
      '  channels.wecom.templates.emptyReply "⚠️ 未能生成可展示的回复…"',
      '  channels.wecom.templates.finishFooter "⏱ {elapsed}s · 已完成"',
      '  channels.wecom.templates.welcome "你好，我是助手"',
    ],
    shouldShow: ({ cfg, accountId }) => !isConfigured(cfg, accountId),
  },

  // ── 凭据：Bot WS + Bot Webhook + Agent ──────────────────────────────
  credentials: [...BOT_CREDENTIALS, ...WEBHOOK_CREDENTIALS, ...AGENT_CREDENTIALS],

  // ── 完成后的最终处理 ──────────────────────────────────────────────────
  finalize: async ({ cfg, accountId }) => {
    let result = cfg;
    const account = getAccount(result, accountId);

    // 自动检测：如果填了 Webhook Token + AESKey 但未设置 connectionMode，自动设为 webhook
    if (account.token?.trim() && account.encodingAESKey?.trim() && account.config.connectionMode !== "webhook") {
      result = setWeComAccountMulti(result, { connectionMode: "webhook" as any }, accountId);
    }

    if (isConfigured(result, accountId) && !account.enabled) {
      return { cfg: setWeComAccountMulti(result, { enabled: true }, accountId) };
    }
    return undefined;
  },

  // ── 完成提示 ──────────────────────────────────────────────────────────
  completionNote: {
    title: "企业微信配置完成",
    lines: [
      "企业微信接入已配置完成。",
      "Bot WebSocket 模式：运行 `openclaw gateway restart` 后立即可用。",
      "Bot Webhook 模式：在企微后台设置回调 URL 为 `https://<host>/plugins/wecom/bot/<accountId>`。",
      "Agent 模式：在企微后台「API接收」中设置回调 URL 后保存（需先启动 Gateway）。",
    ],
    shouldShow: ({ cfg, accountId }) => isConfigured(cfg, accountId),
  },

  // ── DM 策略 ──────────────────────────────────────────────────────────
  dmPolicy,

  // ── 禁用 ─────────────────────────────────────────────────────────────
  disable: (cfg) => setWeComAccountMulti(cfg, { enabled: false }),
};

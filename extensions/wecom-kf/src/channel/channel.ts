import type {
  ChannelAccountSnapshot,
  ChannelPlugin,
  OpenClawConfig,
} from "openclaw/plugin-sdk";

import {
  deleteAccountFromConfigSection,
  setAccountEnabledInConfigSection,
} from "openclaw/plugin-sdk/core";

import {
  DEFAULT_ACCOUNT_ID,
  listWecomAccountIds,
  resolveDefaultWecomAccountId,
  resolveWecomAccount,
  resolveWecomAccountConflict,
} from "../config/index.js";
import type { ResolvedWecomAccount } from "../types/index.js";
import { monitorWecomProvider } from "../runtime/gateway-monitor.js";
import { wecomKfOnboardingAdapter, setKfAccountConfig } from "./onboarding.js";
import { resolveKfAccountWebhookPath } from "../config/kf-routes.js";
import { wecomOutbound } from "../outbound/index.js";

const meta = {
  id: "wecom-kf",
  label: "WeCom KF",
  selectionLabel: "WeCom KF (plugin)",
  docsPath: "/channels/wecom-kf",
  docsLabel: "wecom-kf",
  blurb: "WeChat Work customer service (KF) — multi-account AI agents via encrypted webhooks.",
  aliases: ["wecom-kf", "wechat-kf", "微信客服", "企微客服"],
  order: 86,
  quickstartAllowFrom: true,
};

function normalizeWecomMessagingTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return (
    trimmed
      .replace(/^(wecom-kf-agent|wecom-kf|wecom-cs-agent|wecom-cs|wecom-agent|wecom|wechatwork|wework|qywx):/i, "")
      .trim() || undefined
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- onboarding 在 >=3.22 中已重命名为 setupWizard，
// 但我们仍设置旧字段以兼容 <3.22 版本的 OpenClaw。
export const wecomPlugin: ChannelPlugin<ResolvedWecomAccount> & Record<string, unknown> = {
  id: "wecom-kf",
  meta,
  onboarding: wecomKfOnboardingAdapter as any,
  setupWizard: wecomKfOnboardingAdapter as any,
  setup: {
    resolveAccountId: ({ cfg, accountId }) => {
      return accountId?.trim() || resolveDefaultWecomAccountId(cfg as OpenClawConfig) || DEFAULT_ACCOUNT_ID;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      return setKfAccountConfig({
        cfg: cfg as OpenClawConfig,
        accountId,
        patch: {
          token: input.token?.trim() ?? "",
          encodingAESKey: input.accessToken?.trim() ?? "",
        },
      });
    },
    validateInput: ({ input }) => {
      if (!input.token?.trim()) return "KF webhook 模式需要 --token <Token>";
      if (!input.accessToken?.trim()) return "KF webhook 模式需要 --access-token <EncodingAESKey>";
      return null;
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  reload: { configPrefixes: ["channels.wecom-kf"] },
  // NOTE: We intentionally avoid Zod -> JSON Schema conversion at plugin-load time.
  // Some OpenClaw runtime environments load plugin modules via jiti in a way that can
  // surface zod `toJSONSchema()` binding issues (e.g. `this` undefined leading to `_zod` errors).
  // A permissive schema keeps config UX working while preventing startup failures.
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: true,
      properties: {},
    },
  },
  config: {
    listAccountIds: (cfg) => listWecomAccountIds(cfg as OpenClawConfig),
    resolveAccount: (cfg, accountId) => resolveWecomAccount({ cfg: cfg as OpenClawConfig, accountId }),
    defaultAccountId: (cfg) => resolveDefaultWecomAccountId(cfg as OpenClawConfig),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "wecom-kf",
        accountId,
        enabled,
        allowTopLevel: true,
      }) as OpenClawConfig,
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg: cfg as OpenClawConfig,
        sectionKey: "wecom-kf",
        accountId,
        clearBaseFields: ["bot", "agent"],
      }) as OpenClawConfig,
    isConfigured: (account, cfg) => {
      if (!account.configured) {
        return false;
      }
      return !resolveWecomAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
    },
    unconfiguredReason: (account, cfg) =>
      resolveWecomAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      })?.message ?? "not configured",
    describeAccount: (account, cfg): ChannelAccountSnapshot => {
      const conflict = resolveWecomAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured && !conflict,
        webhookPath: resolveKfAccountWebhookPath({
          accountId: account.accountId,
          webhookPath: account.config.webhookPath,
        }),
      };
    },
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveWecomAccount({ cfg: cfg as OpenClawConfig, accountId });
      // 与其他渠道保持一致：直接返回 allowFrom，空则允许所有人
      const allowFrom = account.agent?.config.dm?.allowFrom ?? account.bot?.config.dm?.allowFrom ?? [];
      return allowFrom.map((entry) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  // security 配置在 WeCom 中不需要，框架会通过 resolveAllowFrom 自动判断
  groups: {
    // WeCom bots are usually mention-gated by the platform in groups already.
    resolveRequireMention: () => true,
  },
  threading: {
    resolveReplyToMode: () => "off",
  },
  messaging: {
    normalizeTarget: normalizeWecomMessagingTarget,
    targetResolver: {
      looksLikeId: (raw) => Boolean(raw.trim()),
      hint: "<userid|chatid>",
    },
  },
  outbound: {
    ...wecomOutbound,
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      webhookPath: snapshot.webhookPath ?? null,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      lastInboundAt: snapshot.lastInboundAt ?? null,
      lastOutboundAt: snapshot.lastOutboundAt ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => {
      // Real KF probe: check API access by calling getAccessToken
      // Backported from research/openclaw-china probeWecomKfAccount
      try {
        const resolved = account as Record<string, unknown>;
        const agentCfg = resolved.agent as Record<string, unknown> | undefined;
        const kfCfg = resolved.kf as Record<string, unknown> | undefined;

        const corpId = (kfCfg?.corpId ?? resolved.corpId ?? "") as string;
        const corpSecret = (kfCfg?.corpSecret ?? resolved.corpSecret ?? "") as string;
        const token = (kfCfg?.token ?? resolved.token ?? "") as string;
        const encodingAESKey = (kfCfg?.encodingAESKey ?? resolved.encodingAESKey ?? "") as string;

        // Check if KF is configured
        if (!corpId || !token || !encodingAESKey) {
          return { ok: false, error: "KF not configured: missing corpId/token/encodingAESKey" };
        }

        // Check if can send actively
        if (!corpSecret) {
          return {
            ok: false,
            error: "corpSecret not configured — cannot send active messages yet. Configure corpSecret and restart.",
          };
        }

        // Real API check
        const { getAccessToken } = await import("../agent/api-client.js");
        await getAccessToken({
          accountId: "kf-probe",
          enabled: true,
          configured: true,
          corpId,
          corpSecret,
          token: "",
          encodingAESKey: "",
          config: { corpId, corpSecret, token: "", encodingAESKey: "" },
        });

        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    buildAccountSnapshot: ({ account, runtime, cfg }) => {
      const conflict = resolveWecomAccountConflict({
        cfg: cfg as OpenClawConfig,
        accountId: account.accountId,
      });
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured: account.configured && !conflict,
        webhookPath: resolveKfAccountWebhookPath({
          accountId: account.accountId,
          webhookPath: account.config.webhookPath,
        }),
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? conflict?.message ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
        dmPolicy: account.bot?.config.dm?.policy ?? "pairing",
      };
    },
  },
  gateway: {
    /**
     * **startAccount (启动账号)**
     *
     * WeCom lifecycle is long-running: keep webhook targets active until
     * gateway stop/reload aborts the account.
     */
    startAccount: monitorWecomProvider,
    stopAccount: async (ctx) => {
      ctx.setStatus({
        accountId: ctx.account.accountId,
        running: false,
        lastStopAt: Date.now(),
      });
    },
  },
};

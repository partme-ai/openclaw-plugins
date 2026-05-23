/**
 * 微信客服（KF）配置向导
 *
 * 专注 corpId / token / encodingAESKey / open_kfid 等 KF 凭证，不含客户联系 Bot/Agent 双模式。
 * 自 research/openclaw-china/extensions/wecom-kf 移植并适配 OpenClaw plugin-sdk。
 */

import type { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";

import {
    DEFAULT_ACCOUNT_ID,
    listWecomAccountIds,
    resolveDefaultWecomAccountId,
    resolveWecomAccount,
} from "../config/index.js";
import {
    DEFAULT_KF_WEBHOOK_PATH,
    normalizeRoutePath,
    resolveKfAccountWebhookPath,
} from "../config/kf-routes.js";
import type { WecomKfConfig } from "../types/index.js";

type ChannelOnboardingDmPolicy = {
    label: string;
    channel: string;
    policyKey: string;
    allowFromKey: string;
    getCurrent: (cfg: OpenClawConfig, accountId?: string) => string;
    setPolicy: (cfg: OpenClawConfig, policy: string, accountId?: string) => OpenClawConfig;
};

type ChannelOnboardingAdapter = {
    channel: string;
    dmPolicy?: ChannelOnboardingDmPolicy;
    getStatus: (ctx: { cfg: OpenClawConfig }) => Promise<{
        channel: string;
        configured: boolean;
        statusLines: string[];
        selectionHint?: string;
        quickstartScore?: number;
    }>;
    configure: (ctx: {
        cfg: OpenClawConfig;
        prompter: WizardPrompter;
        accountOverrides: Record<string, string | undefined>;
        shouldPromptAccountIds: boolean;
    }) => Promise<{ cfg: OpenClawConfig; accountId?: string }>;
    disable?: (cfg: OpenClawConfig) => OpenClawConfig;
};

const CHANNEL_ID = "wecom-kf" as const;

function getWecomKfBlock(cfg: OpenClawConfig): WecomKfConfig | undefined {
    return cfg.channels?.[CHANNEL_ID] as WecomKfConfig | undefined;
}

function isPromptCancelled<T>(value: T | symbol): value is symbol {
    return typeof value === "symbol";
}

/**
 * 写入 channels.wecom-kf 账号级或顶层 KF 配置。
 */
function setKfAccountConfig(params: {
    cfg: OpenClawConfig;
    accountId: string;
    patch: Record<string, unknown>;
}): OpenClawConfig {
    const existing = getWecomKfBlock(params.cfg) ?? {};

    if (params.accountId === DEFAULT_ACCOUNT_ID) {
        return {
            ...params.cfg,
            channels: {
                ...params.cfg.channels,
                [CHANNEL_ID]: {
                    ...existing,
                    ...params.patch,
                    enabled: true,
                },
            },
        } as OpenClawConfig;
    }

    const accounts = existing.accounts ?? {};
    return {
        ...params.cfg,
        channels: {
            ...params.cfg.channels,
            [CHANNEL_ID]: {
                ...existing,
                enabled: true,
                accounts: {
                    ...accounts,
                    [params.accountId]: {
                        ...accounts[params.accountId],
                        ...params.patch,
                        enabled: true,
                    },
                },
            },
        },
    } as OpenClawConfig;
}

/**
 * 展示 KF 接入前置说明。
 */
async function noteWecomKfHelp(prompter: WizardPrompter): Promise<void> {
    await prompter.note(
        [
            "本插件专注微信客服（KF），不含客户联系 Bot/Agent。",
            "",
            "1) 在微信客服管理后台开启 API 管理",
            "2) 配置回调 URL、Token、EncodingAESKey、企业 ID 与 open_kfid",
            "3) 微信客服 Secret 可最后填写（首次校验可先留空）",
            "4) 将客服账号授权给可调用接口的自建应用",
        ].join("\n"),
        "WeCom KF 配置",
    );
}

/**
 * 微信客服（KF）渠道 Onboarding 适配器。
 */
export const wecomKfOnboardingAdapter: ChannelOnboardingAdapter = {
    channel: CHANNEL_ID,

    getStatus: async ({ cfg }) => {
        const accountId = resolveDefaultWecomAccountId(cfg);
        const account = resolveWecomAccount({ cfg, accountId });
        const merged = account.config;
        const hasCorpSecret = Boolean(merged.corpSecret?.trim());
        const hasOpenKfId = Boolean(merged.openKfId?.trim());
        const configured = Boolean(
            merged.corpId?.trim() &&
                merged.token?.trim() &&
                merged.encodingAESKey?.trim(),
        );
        const webhookPath = resolveKfAccountWebhookPath({
            accountId,
            webhookPath: merged.webhookPath,
        });

        return {
            channel: CHANNEL_ID,
            configured,
            statusLines: [
                configured
                    ? `WeCom KF: 已配置${accountId !== DEFAULT_ACCOUNT_ID ? ` (${accountId})` : ""}`
                    : "WeCom KF: 需要 corpId / token / encodingAESKey",
                `Webhook: ${webhookPath}`,
                hasCorpSecret ? "corpSecret: 已配置" : "corpSecret: 未配置（回调校验通过后再补）",
                hasOpenKfId ? "open_kfid: 已配置" : "open_kfid: 未配置（主动发送不可用）",
            ],
            selectionHint: configured
                ? hasCorpSecret && hasOpenKfId
                    ? "已配置"
                    : "已配置，建议补全 corpSecret / open_kfid"
                : "需要 KF 基础凭证",
            quickstartScore: configured ? (hasCorpSecret && hasOpenKfId ? 2 : 1) : 0,
        };
    },

    configure: async ({ cfg, prompter, accountOverrides }) => {
        const requestedAccountId = accountOverrides[CHANNEL_ID]?.trim();
        const accountId =
            requestedAccountId ||
            (listWecomAccountIds(cfg).length > 0
                ? resolveDefaultWecomAccountId(cfg)
                : DEFAULT_ACCOUNT_ID);
        const account = resolveWecomAccount({ cfg, accountId });
        const merged = account.config;

        await noteWecomKfHelp(prompter);

        const webhookPathInput = await prompter.text({
            message: "请输入 webhookPath（企微后台回调 URL 路径）",
            initialValue: merged.webhookPath ?? DEFAULT_KF_WEBHOOK_PATH,
            validate: (value) => (String(value ?? "").trim() ? undefined : "webhookPath 不能为空"),
        });
        if (isPromptCancelled(webhookPathInput)) return { cfg, accountId };

        const token = await prompter.text({
            message: "请输入回调 Token",
            initialValue: merged.token,
            validate: (value) => (String(value ?? "").trim() ? undefined : "token 不能为空"),
        });
        if (isPromptCancelled(token)) return { cfg, accountId };

        const encodingAESKey = await prompter.text({
            message: "请输入回调 EncodingAESKey",
            initialValue: merged.encodingAESKey,
            validate: (value) => (String(value ?? "").trim() ? undefined : "encodingAESKey 不能为空"),
        });
        if (isPromptCancelled(encodingAESKey)) return { cfg, accountId };

        const corpId = await prompter.text({
            message: "请输入企业 ID (corpId)",
            initialValue: merged.corpId,
            validate: (value) => (String(value ?? "").trim() ? undefined : "corpId 不能为空"),
        });
        if (isPromptCancelled(corpId)) return { cfg, accountId };

        const openKfId = await prompter.text({
            message: "请输入客服账号 ID (open_kfid)",
            initialValue: merged.openKfId,
            validate: (value) => (String(value ?? "").trim() ? undefined : "open_kfid 不能为空"),
        });
        if (isPromptCancelled(openKfId)) return { cfg, accountId };

        const corpSecret = await prompter.text({
            message: "请输入微信客服 Secret（可最后填写；首次接入可先留空）",
            initialValue: merged.corpSecret,
        });
        if (isPromptCancelled(corpSecret)) return { cfg, accountId };

        const nextCfg = setKfAccountConfig({
            cfg,
            accountId,
            patch: {
                webhookPath: normalizeRoutePath(String(webhookPathInput), DEFAULT_KF_WEBHOOK_PATH),
                token: String(token).trim(),
                encodingAESKey: String(encodingAESKey).trim(),
                corpId: String(corpId).trim(),
                openKfId: String(openKfId).trim(),
                corpSecret: String(corpSecret).trim() || undefined,
            },
        });

        await prompter.note(
            [
                "✅ KF 配置已保存",
                `回调 URL: https://您的域名${normalizeRoutePath(String(webhookPathInput), DEFAULT_KF_WEBHOOK_PATH)}`,
                `账号 ID: ${accountId}`,
            ].join("\n"),
            "配置完成",
        );

        return { cfg: nextCfg, accountId };
    },

    disable: (cfg): OpenClawConfig => ({
        ...cfg,
        channels: {
            ...cfg.channels,
            [CHANNEL_ID]: {
                ...(getWecomKfBlock(cfg) ?? {}),
                enabled: false,
            },
        },
    }),
};

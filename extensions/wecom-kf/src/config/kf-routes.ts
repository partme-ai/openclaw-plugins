/**
 * KF 回调路由与企微 API 基础 URL 解析
 *
 * 从 research/openclaw-china/extensions/wecom-kf 移植，供 index.ts 动态注册 HTTP 路由。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { WecomKfConfig } from "../types/index.js";
import { WEBHOOK_PATHS } from "../types/constants.js";

/** 默认 KF 回调路径（无自定义 webhookPath 时使用） */
export const DEFAULT_KF_WEBHOOK_PATH = "/wecom-kf";

/** 默认企微 OpenAPI 域名 */
export const DEFAULT_API_BASE_URL = "https://qyapi.weixin.qq.com";

/**
 * 规范化 HTTP 路径：补上前导 `/`，空值回退 fallback。
 */
export function normalizeRoutePath(path: string | undefined, fallback: string): string {
    const trimmed = path?.trim() ?? "";
    const candidate = trimmed || fallback;
    return candidate.startsWith("/") ? candidate : `/${candidate}`;
}

/**
 * 收集需注册的 KF 回调路径。
 *
 * 包含：顶层 `webhookPath`、各账号 `accounts.*.webhookPath`、以及内置兼容别名。
 */
export function collectWecomKfRoutePaths(config: WecomKfConfig | undefined): string[] {
    const routes = new Set<string>([
        normalizeRoutePath(config?.webhookPath, DEFAULT_KF_WEBHOOK_PATH),
        WEBHOOK_PATHS.KF,
        WEBHOOK_PATHS.KF_PLUGIN,
        "/plugins/wecom-kf",
        DEFAULT_KF_WEBHOOK_PATH,
    ]);

    for (const accountConfig of Object.values(config?.accounts ?? {})) {
        const customPath = accountConfig?.webhookPath?.trim();
        if (!customPath) continue;
        routes.add(normalizeRoutePath(customPath, DEFAULT_KF_WEBHOOK_PATH));
    }

    return [...routes];
}

/**
 * 解析企微 API 基础 URL（可选覆盖，默认官方域名）。
 */
export function resolveApiBaseUrl(config?: { apiBaseUrl?: string }): string {
    const raw = (config?.apiBaseUrl ?? "").trim();
    return raw ? raw.replace(/\/+$/, "") : DEFAULT_API_BASE_URL;
}

/**
 * 是否启用 Legacy wecom-cs Bot/Agent 回调与 monitor 主路径。
 *
 * 默认 `false`：Gateway 仅注册 KF 回调；Phase 2 将移除 monitor 中的 wecom-cs 逻辑。
 */
export function isLegacyWecomCsEnabled(cfg: OpenClawConfig | undefined): boolean {
    const channel = cfg?.channels?.["wecom-kf"] as WecomKfConfig | undefined;
    return channel?.legacyWecomCsEnabled === true;
}

/**
 * 解析账号在状态/UI 中展示的 KF webhookPath。
 */
export function resolveKfAccountWebhookPath(params: {
    accountId: string;
    webhookPath?: string;
}): string {
    const custom = params.webhookPath?.trim();
    if (custom) {
        return normalizeRoutePath(custom, DEFAULT_KF_WEBHOOK_PATH);
    }
    if (params.accountId !== "default") {
        return `${DEFAULT_KF_WEBHOOK_PATH}/${params.accountId}`;
    }
    return DEFAULT_KF_WEBHOOK_PATH;
}

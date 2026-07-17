/**
 * KF 回调路由与企微 API 基础 URL 解析
 *
 * 从 research/openclaw-china/extensions/wecom-kf 移植，供 index.ts 动态注册 HTTP 路由。
 */

import type { OpenClawConfig } from "openclaw/plugin-sdk";

import type { WecomKfConfig } from "../types/index.js";
import { getWecomKfChannelBlock } from "./channel-block.js";
import { WEBHOOK_PATHS } from "../types/constants.js";
export { getWecomKfChannelBlock, LEGACY_WECOM_CS_CHANNEL_KEY, warnWecomCsChannelDeprecation } from "./channel-block.js";

/** 默认 KF 回调路径（无自定义 webhookPath 时使用） */
export const DEFAULT_KF_WEBHOOK_PATH = "/wecom-kf";

/** 默认企微 OpenAPI 域名 */
export const DEFAULT_API_BASE_URL = "https://qyapi.weixin.qq.com";

export type WecomKfRouteBinding = {
    path: string;
    accountId: string;
};

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
    return collectWecomKfRouteBindings(config).map((binding) => binding.path);
}

/**
 * 收集回调路径与账号的确定性绑定。验签发生在 XML 解密前，因此多账号必须先由路径选择 Token/AESKey。
 */
export function collectWecomKfRouteBindings(config: WecomKfConfig | undefined): WecomKfRouteBinding[] {
    const defaultAccountId = config?.defaultAccount?.trim() || "default";
    const bindings = new Map<string, string>();
    const add = (path: string, accountId: string): void => {
        const normalized = normalizeRoutePath(path, DEFAULT_KF_WEBHOOK_PATH);
        const existing = bindings.get(normalized);
        if (existing && existing !== accountId) {
            throw new Error(`wecom-kf webhook path ${normalized} is assigned to both ${existing} and ${accountId}`);
        }
        bindings.set(normalized, accountId);
    };

    add(normalizeRoutePath(config?.webhookPath, DEFAULT_KF_WEBHOOK_PATH), defaultAccountId);
    add(WEBHOOK_PATHS.KF, defaultAccountId);
    add(WEBHOOK_PATHS.KF_PLUGIN, defaultAccountId);
    add("/plugins/wecom-kf", defaultAccountId);
    add(DEFAULT_KF_WEBHOOK_PATH, defaultAccountId);

    for (const [accountId, accountConfig] of Object.entries(config?.accounts ?? {})) {
        add(resolveKfAccountWebhookPath({ accountId, webhookPath: accountConfig?.webhookPath }), accountId);
    }

    return [...bindings].map(([path, accountId]) => ({ path, accountId }));
}

/**
 * 解析企微 API 基础 URL（可选覆盖，默认官方域名）。
 */
export function resolveApiBaseUrl(config?: { apiBaseUrl?: string }): string {
    const raw = (config?.apiBaseUrl ?? "").trim();
    if (!raw) return DEFAULT_API_BASE_URL;
    let parsed: URL;
    try {
        parsed = new URL(raw);
    } catch {
        throw new Error("wecom-kf apiBaseUrl must be an absolute HTTPS URL");
    }
    const loopbackHost = parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]";
    // 生产代理必须使用 HTTPS；仅对白名单 loopback 放行 HTTP，支持本地沙箱、离线联调和安装态 E2E。
    if ((parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopbackHost)) ||
        parsed.username || parsed.password) {
        throw new Error("wecom-kf apiBaseUrl must use HTTPS (HTTP is allowed only for loopback) without embedded credentials");
    }
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
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

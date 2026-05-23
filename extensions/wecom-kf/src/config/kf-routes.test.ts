import { describe, expect, it } from "vitest";

import {
    collectWecomKfRoutePaths,
    DEFAULT_API_BASE_URL,
    DEFAULT_KF_WEBHOOK_PATH,
    isIcsEnabled,
    isLegacyWecomCsEnabled,
    normalizeRoutePath,
    resolveApiBaseUrl,
    resolveKfAccountWebhookPath,
} from "./kf-routes.js";
import type { WecomKfConfig } from "../types/index.js";

describe("kf-routes", () => {
    it("normalizeRoutePath 补全前导斜杠", () => {
        expect(normalizeRoutePath("wecom-kf", DEFAULT_KF_WEBHOOK_PATH)).toBe("/wecom-kf");
        expect(normalizeRoutePath(undefined, DEFAULT_KF_WEBHOOK_PATH)).toBe(DEFAULT_KF_WEBHOOK_PATH);
    });

    it("collectWecomKfRoutePaths 包含默认路径与账号自定义路径", () => {
        const config: WecomKfConfig = {
            webhookPath: "/custom/kf",
            accounts: {
                desk2: { webhookPath: "/kf/desk2" },
            },
        };
        const paths = collectWecomKfRoutePaths(config);
        expect(paths).toContain("/custom/kf");
        expect(paths).toContain("/kf/desk2");
        expect(paths).toContain("/wecom/kefu");
        expect(paths).toContain("/plugins/wecom-kf");
    });

    it("resolveApiBaseUrl 默认官方域名并可覆盖", () => {
        expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
        expect(resolveApiBaseUrl({ apiBaseUrl: "https://proxy.example.com/" })).toBe(
            "https://proxy.example.com",
        );
    });

    it("isLegacyWecomCsEnabled 默认 false", () => {
        expect(isLegacyWecomCsEnabled(undefined)).toBe(false);
        expect(
            isLegacyWecomCsEnabled({
                channels: { "wecom-kf": { enabled: true } },
            } as never),
        ).toBe(false);
        expect(
            isLegacyWecomCsEnabled({
                channels: { "wecom-kf": { legacyWecomCsEnabled: true } },
            } as never),
        ).toBe(true);
    });

    it("isIcsEnabled 默认 false，显式 true 时启用", () => {
        expect(isIcsEnabled(undefined)).toBe(false);
        expect(
            isIcsEnabled({
                channels: { "wecom-kf": {} },
            } as never),
        ).toBe(false);
        expect(
            isIcsEnabled({
                channels: { "wecom-kf": { icsEnabled: true } },
            } as never),
        ).toBe(true);
    });

    it("resolveKfAccountWebhookPath 支持账号级默认后缀", () => {
        expect(
            resolveKfAccountWebhookPath({ accountId: "default", webhookPath: undefined }),
        ).toBe(DEFAULT_KF_WEBHOOK_PATH);
        expect(
            resolveKfAccountWebhookPath({ accountId: "desk-a", webhookPath: undefined }),
        ).toBe("/wecom-kf/desk-a");
        expect(
            resolveKfAccountWebhookPath({ accountId: "desk-a", webhookPath: "/my/kf" }),
        ).toBe("/my/kf");
    });
});

import { describe, expect, it } from "vitest";

import {
    collectWecomKfRoutePaths,
    collectWecomKfRouteBindings,
    DEFAULT_API_BASE_URL,
    DEFAULT_KF_WEBHOOK_PATH,
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

    it("为未显式配置路径的多账号生成独立回调路径", () => {
        const bindings = collectWecomKfRouteBindings({
            defaultAccount: "desk1",
            accounts: { desk1: {}, desk2: {} },
        });
        expect(bindings).toContainEqual({ path: "/wecom-kf", accountId: "desk1" });
        expect(bindings).toContainEqual({ path: "/wecom-kf/desk2", accountId: "desk2" });
    });

    it("拒绝多个账号复用同一个回调路径", () => {
        expect(() => collectWecomKfRouteBindings({
            accounts: {
                desk1: { webhookPath: "/shared" },
                desk2: { webhookPath: "/shared" },
            },
        })).toThrow("assigned to both");
    });

    it("resolveApiBaseUrl 默认官方域名并可覆盖", () => {
        expect(resolveApiBaseUrl()).toBe(DEFAULT_API_BASE_URL);
        expect(resolveApiBaseUrl({ apiBaseUrl: "https://proxy.example.com/" })).toBe(
            "https://proxy.example.com",
        );
        expect(() => resolveApiBaseUrl({ apiBaseUrl: "http://127.0.0.1:8080" })).toThrow("must use HTTPS");
        expect(() => resolveApiBaseUrl({ apiBaseUrl: "not-a-url" })).toThrow("absolute HTTPS URL");
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

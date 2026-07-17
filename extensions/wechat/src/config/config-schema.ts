/**
 * @module wechat/config/config-schema
 *
 * 微信通道 Zod 配置 schema。
 */

import { z } from "zod";

import { CDN_BASE_URL, DEFAULT_BASE_URL } from "../auth/accounts.js";
import { validateWeixinApiBaseUrl, validateWeixinCdnBaseUrl } from "../api/endpoint-policy.js";

// ---------------------------------------------------------------------------
// Zod config schema
// ---------------------------------------------------------------------------

const accountShape = {
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  allowFrom: z.array(z.string().trim().min(1).max(256)).max(10_000).default([]),
  baseUrl: z.url().default(DEFAULT_BASE_URL),
  cdnBaseUrl: z.url().default(CDN_BASE_URL),
  allowCustomApiBaseUrl: z.boolean().default(false),
  allowCustomCdnBaseUrl: z.boolean().default(false),
  routeTag: z.union([z.number().safe(), z.string().trim().min(1).max(128)]).optional(),
  mediaLocalRoots: z.array(z.string().trim().min(1).max(4096)).max(128).default([]),
};

function enforceEndpointPolicy(
  value: z.infer<z.ZodObject<typeof accountShape>>,
  ctx: z.RefinementCtx,
): void {
  for (const [path, validate] of [
    ["baseUrl", () => validateWeixinApiBaseUrl(value.baseUrl, value.allowCustomApiBaseUrl)],
    ["cdnBaseUrl", () => validateWeixinCdnBaseUrl(value.cdnBaseUrl, value.allowCustomCdnBaseUrl)],
  ] as const) {
    try {
      validate();
    } catch (error) {
      ctx.addIssue({ code: "custom", path: [path], message: error instanceof Error ? error.message : String(error) });
    }
  }
}

const weixinAccountSchema = z.strictObject(accountShape).superRefine(enforceEndpointPolicy);

/** Top-level weixin config schema (token is stored in credentials file, not config). */
export const WeixinConfigSchema = z.strictObject({
  ...accountShape,
  accounts: z.record(z.string(), weixinAccountSchema).optional(),
  /** ISO 8601; bumped on each successful login to refresh gateway config from disk. */
  channelConfigUpdatedAt: z.string().optional(),
}).superRefine(enforceEndpointPolicy);

/**
 * @module wechat/config/config-schema
 *
 * 微信通道 Zod 配置 schema。
 */

import { z } from "zod";

import { CDN_BASE_URL, DEFAULT_BASE_URL } from "../auth/accounts.js";

// ---------------------------------------------------------------------------
// Zod config schema
// ---------------------------------------------------------------------------

const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", {
  message: "must use HTTPS",
});

const weixinAccountSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
  baseUrl: httpsUrl.default(DEFAULT_BASE_URL),
  cdnBaseUrl: httpsUrl.default(CDN_BASE_URL),
  routeTag: z.number().optional(),
});

/** Top-level weixin config schema (token is stored in credentials file, not config). */
export const WeixinConfigSchema = weixinAccountSchema.extend({
  accounts: z.record(z.string(), weixinAccountSchema).optional(),
  /** ISO 8601; bumped on each successful login to refresh gateway config from disk. */
  channelConfigUpdatedAt: z.string().optional(),
});

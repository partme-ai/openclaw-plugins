/** 抖音生活服务 OpenAPI 工具。 */

import type { ChannelLimitsOpenClawConfig } from "../runtime/runtime-api.js";
import type { DouyinAccountConfig, ToolDefinition } from "../types.js";
import { requestDouyinOpenApi } from "../api/openapi.js";

/** Tool 执行时惰性读取的 OpenClaw 根配置与抖音多账号配置。 */
export type DouyinToolsConfig = {
  rootConfig: ChannelLimitsOpenClawConfig;
  section?: DouyinAccountConfig;
};

function resolveToolAccount(
  section: DouyinAccountConfig | undefined,
  accountName: unknown,
): DouyinAccountConfig | undefined {
  if (!section) return undefined;
  const name = typeof accountName === "string" && accountName.trim() ? accountName.trim() : undefined;
  if (name) {
    const selected = section.accounts?.[name];
    if (!selected) throw new Error(`[douyin] configured account not found: ${name}`);
    return { ...section, ...selected };
  }
  if (section.app_key && section.app_secret) return section;
  const first = Object.values(section.accounts ?? {})[0];
  return first ? { ...section, ...first } : section;
}

function requiredString(value: unknown, field: string): string {
  const normalized = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!normalized) throw new Error(`[douyin] ${field} is required`);
  return normalized;
}

function optionalInteger(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`[douyin] ${field} must be an integer`);
  return parsed;
}

/** 创建带运行时配置注入的真实抖音生活服务工具。 */
export function createDouyinTools(getConfig: () => DouyinToolsConfig): ToolDefinition[] {
  return [
    {
      name: "douyin_query_orders",
      description: "通过抖音生活服务 OpenAPI 查询订单列表或订单详情",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          account: { type: "string", description: "OpenClaw 中配置的抖音账号名称" },
          account_id: { type: "string", description: "来客商户根账户 ID；未传时读取配置" },
          page_num: { type: "integer", minimum: 1, default: 1 },
          page_size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
          cursor: { type: "string" },
          order_id: { type: "string" },
          ext_order_id: { type: "string" },
          open_id: { type: "string" },
          order_status: { type: "integer" },
          create_order_start_time: { type: "integer", description: "创单起始秒时间戳" },
          create_order_end_time: { type: "integer", description: "创单结束秒时间戳" },
          update_order_start_time: { type: "integer", description: "修改起始秒时间戳" },
          update_order_end_time: { type: "integer", description: "修改结束秒时间戳" },
        },
      },
      execute: async (args) => {
        const current = getConfig();
        const account = resolveToolAccount(current.section, args.account);
        if (!account) throw new Error("[douyin] channels.douyin is not configured");
        const accountId = requiredString(args.account_id ?? account.account_id ?? account.shop_id, "account_id");
        const pageNum = optionalInteger(args.page_num, "page_num") ?? 1;
        const pageSize = optionalInteger(args.page_size, "page_size") ?? 20;
        if (pageNum < 1 || pageSize < 1 || pageSize > 100 || pageNum * pageSize > 10_000) {
          throw new Error("[douyin] page_num/page_size exceed the official pagination limits");
        }
        return requestDouyinOpenApi({
          context: { account, rootConfig: current.rootConfig },
          path: "/goodlife/v1/trade/order/query/",
          method: "GET",
          retrySafe: true,
          query: {
            account_id: accountId,
            page_num: pageNum,
            page_size: pageSize,
            cursor: args.cursor,
            order_id: args.order_id,
            ext_order_id: args.ext_order_id,
            open_id: args.open_id,
            order_status: optionalInteger(args.order_status, "order_status"),
            create_order_start_time: optionalInteger(args.create_order_start_time, "create_order_start_time"),
            create_order_end_time: optionalInteger(args.create_order_end_time, "create_order_end_time"),
            update_order_start_time: optionalInteger(args.update_order_start_time, "update_order_start_time"),
            update_order_end_time: optionalInteger(args.update_order_end_time, "update_order_end_time"),
          },
        });
      },
    },
    {
      name: "douyin_reply_review",
      description: "通过抖音生活服务餐饮评价接口回复门店评价",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          account: { type: "string", description: "OpenClaw 中配置的抖音账号名称" },
          account_id: { type: "string", description: "来客商户根账户 ID；未传时读取配置" },
          poi_id: { type: "string", description: "门店 POI ID；未传时读取配置" },
          rate_id: { type: "string", description: "评价 ID" },
          text: { type: "string", minLength: 1, description: "回复内容" },
        },
        required: ["rate_id", "text"],
      },
      execute: async (args) => {
        const current = getConfig();
        const account = resolveToolAccount(current.section, args.account);
        if (!account) throw new Error("[douyin] channels.douyin is not configured");
        return requestDouyinOpenApi({
          context: { account, rootConfig: current.rootConfig },
          path: "/goodlife/v1/akte/comment/reply/",
          method: "POST",
          body: {
            account_id: requiredString(args.account_id ?? account.account_id ?? account.shop_id, "account_id"),
            poi_id: requiredString(args.poi_id ?? account.poi_id, "poi_id"),
            rate_id: requiredString(args.rate_id, "rate_id"),
            text: requiredString(args.text, "text"),
          },
        });
      },
    },
  ];
}

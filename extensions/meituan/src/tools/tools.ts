/**
 * 美团 Agent 运营工具注册模块。
 *
 * **架构角色**：封装美团 Open API 为 Agent 可调用工具（订单、评价、指标、核销等）。
 *
 * **业务说明**：与《美团开放平台对接规格》EP-3 对齐；path 以官方文档为准。
 *
 * **关键依赖**：`../meituan/meituan-api`、`../types`
 */

import type { ToolDefinition } from "../types.js";
import type { MeituanAccountConfig } from "../types.js";
import { meituanApiCall } from "../meituan/meituan-api.js";

/**
 * 创建带运行时配置注入的美团工具列表。
 *
 * @param getConfig 懒加载 `MeituanAccountConfig` 的 getter
 * @returns 可传给 `api.registerTool` 的工具定义数组
 */
export function createMeituanTools(
  getConfig: () => MeituanAccountConfig | undefined
): ToolDefinition[] {
  return [
    {
      name: "meituan_query_orders",
      description: "查询美团订单列表，支持按日期、状态筛选",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "开始日期" },
          date_to: { type: "string", description: "结束日期" },
          status: { type: "string", description: "订单状态" },
          page: { type: "integer", description: "页码" },
          page_size: { type: "integer", description: "每页条数" },
        },
      },
      execute: async (params) => {
        const res = await meituanApiCall(getConfig(), "/open/order/list", "GET", params as Record<string, string | number | undefined>);
        return res;
      },
    },
    {
      name: "meituan_reply_review",
      description: "回复美团店铺评价",
      parameters: {
        type: "object",
        properties: {
          review_id: { type: "string", description: "评价ID" },
          content: { type: "string", description: "回复内容" },
        },
      },
      execute: async (params) => {
        const res = await meituanApiCall(getConfig(), "/open/review/reply", "POST", params as Record<string, string | number | undefined>);
        return res;
      },
    },
    {
      name: "meituan_query_shop_metrics",
      description: "查询店铺经营指标",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string" },
          date_to: { type: "string" },
        },
      },
      execute: async (params) => {
        const res = await meituanApiCall(getConfig(), "/open/shop/metrics", "GET", params as Record<string, string | number | undefined>);
        return res;
      },
    },
    // 扩展工具骨架：团购核销、店铺二维码（参数以美团团购核销 API / 店铺二维码文档为准）
    {
      name: "meituan_verify_writeoff",
      description: "团购核销：核销订单/核销码",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "订单ID" },
          verify_code: { type: "string", description: "核销码（以文档为准）" },
        },
      },
      execute: async (params) => {
        const res = await meituanApiCall(getConfig(), "/open/verify/writeoff", "POST", params as Record<string, string | number | undefined>);
        return res;
      },
    },
    {
      name: "meituan_shop_qrcode",
      description: "获取店铺二维码",
      parameters: {
        type: "object",
        properties: {
          shop_id: { type: "string", description: "门店ID" },
          scene: { type: "string", description: "场景参数（以文档为准）" },
        },
      },
      execute: async (params) => {
        const res = await meituanApiCall(getConfig(), "/open/shop/qrcode", "GET", params as Record<string, string | number | undefined>);
        return res;
      },
    },
  ];
}

/** 静态占位工具（无 getConfig，供测试或未注入配置时使用） */
export const meituanQueryOrders: ToolDefinition = {
  name: "meituan_query_orders",
  description: "查询美团订单列表，支持按日期、状态筛选",
  parameters: {
    type: "object",
    properties: {
      date_from: { type: "string", description: "开始日期" },
      date_to: { type: "string", description: "结束日期" },
      status: { type: "string", description: "订单状态" },
      page: { type: "integer", description: "页码" },
      page_size: { type: "integer", description: "每页条数" },
    },
  },
  execute: async () => ({ data: [] }),
};

export const meituanReplyReview: ToolDefinition = {
  name: "meituan_reply_review",
  description: "回复美团店铺评价",
  parameters: {
    type: "object",
    properties: {
      review_id: { type: "string", description: "评价ID" },
      content: { type: "string", description: "回复内容" },
    },
  },
  execute: async () => ({ ok: true }),
};

export const meituanQueryShopMetrics: ToolDefinition = {
  name: "meituan_query_shop_metrics",
  description: "查询店铺经营指标",
  parameters: {
    type: "object",
    properties: {
      date_from: { type: "string" },
      date_to: { type: "string" },
    },
  },
  execute: async () => ({}),
};

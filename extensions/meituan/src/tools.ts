/**
 * 美团运营工具：与《美团开放平台对接规格》EP-3 一致，封装美团 Open API 调用。
 * 供 registerTool 注册（若运行时提供）。实际 path 与参数以美团接口文档为准。
 */

import type { ToolDefinition } from "./types.js";
import type { MeituanAccountConfig } from "./types.js";
import { meituanApiCall } from "./meituan-api.js";

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

/** 兼容：无 getConfig 时返回占位工具（仅用于测试或未注入配置时） */
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

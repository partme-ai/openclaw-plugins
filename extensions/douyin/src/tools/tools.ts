/**
 * 抖音 Agent 运营工具注册模块。
 *
 * **架构角色**：在 `index.ts` registerFull 中注册 OpenAPI 封装工具，
 * 供 Agent 查询订单、回复评价、拉取经营指标。
 *
 * **业务说明**：与《抖音开放平台对接规格》EP-3 对齐；部分接口仍为 TODO 占位。
 *
 * **关键依赖**：`../config/auth`、`../types`
 */

import type { DouyinAccountConfig } from "../types.js";
import type { ToolDefinition } from "../types.js";
import { getClientToken } from "../config/auth.js";

const OPENAPI_BASE = "https://open.douyin.com";

/** 生活服务 OpenAPI GET 请求封装（query 携带 access_token） */
async function goodlifeGet(accessToken: string, path: string): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${OPENAPI_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
  const res = await fetch(`${url}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  return res.json();
}

/**
 * 创建带运行时配置注入的抖音工具列表。
 *
 * @param getConfig 懒加载 `channels.douyin` 配置的 getter
 * @returns 可传给 `api.registerTool` 的工具定义数组
 */
export function createDouyinTools(
  getConfig: () => DouyinAccountConfig | undefined
): ToolDefinition[] {
  return [
    {
      name: "douyin_query_orders",
      description: "查询抖音订单列表，支持按日期、状态筛选",
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
      execute: async () => {
        const token = await getClientToken(getConfig());
        if (!token) return { error: "missing config or token" };
        // TODO: 调用抖音生活服务订单列表接口，见接口对照表清单
        return { data: [] };
      },
    },
    {
      name: "douyin_reply_review",
      description: "回复抖音店铺评价",
      parameters: {
        type: "object",
        properties: {
          review_id: { type: "string", description: "评价ID" },
          content: { type: "string", description: "回复内容" },
        },
      },
      execute: async () => {
        const token = await getClientToken(getConfig());
        if (!token) return { error: "missing config or token" };
        // TODO: 调用抖音生活服务评价回复接口
        return { ok: true };
      },
    },
    {
      name: "douyin_query_shop_metrics",
      description: "查询抖音店铺经营指标",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string" },
          date_to: { type: "string" },
        },
      },
      execute: async () => {
        const config = getConfig();
        const token = await getClientToken(config);
        if (!token) return { error: "missing config or token" };
        // 真实对接示例：调用生活服务「查询商品品类」接口（scope: life.capacity.goods.query）
        try {
          const data = await goodlifeGet(token, "/goodlife/v1/goods/category/get/");
          return { data };
        } catch (e) {
          return { error: String(e) };
        }
      },
    },
  ];
}

/** 静态占位工具（无 getConfig 注入，不调 OpenAPI，供测试或文档示例） */
export const douyinQueryOrders: ToolDefinition = {
  name: "douyin_query_orders",
  description: "查询抖音订单列表，支持按日期、状态筛选",
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

export const douyinReplyReview: ToolDefinition = {
  name: "douyin_reply_review",
  description: "回复抖音店铺评价",
  parameters: {
    type: "object",
    properties: {
      review_id: { type: "string", description: "评价ID" },
      content: { type: "string", description: "回复内容" },
    },
  },
  execute: async () => ({ ok: true }),
};

export const douyinQueryShopMetrics: ToolDefinition = {
  name: "douyin_query_shop_metrics",
  description: "查询抖音店铺经营指标",
  parameters: {
    type: "object",
    properties: {
      date_from: { type: "string" },
      date_to: { type: "string" },
    },
  },
  execute: async () => ({}),
};

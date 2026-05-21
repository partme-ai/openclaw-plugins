/**
 * 小红书运营工具：与《小红书开放平台对接规格》EP-3 一致，封装小红书 Open API 调用。
 * 供 registerTool 注册；path 与参数以 xiaohongshu.apifox.cn 为准。
 */

import type { ToolDefinition } from "./types.js";
import type { XhsAccountConfig } from "./types.js";
import { xhsApiCallOrProxy } from "./xhs-api.js";

export function createXhsTools(
  getConfig: () => XhsAccountConfig | undefined
): ToolDefinition[] {
  return [
    {
      name: "xhs_query_orders",
      description: "查询小红书订单列表，支持按时间、状态筛选",
      parameters: {
        type: "object",
        properties: {
          start_time: { type: "string", description: "开始时间" },
          end_time: { type: "string", description: "结束时间" },
          order_status: { type: "string", description: "订单状态" },
          page: { type: "integer", description: "页码" },
          page_size: { type: "integer", description: "每页条数" },
        },
      },
      execute: async (params) => {
        const res = await xhsApiCallOrProxy(
          getConfig(),
          "/api/order/list",
          "GET",
          params as Record<string, string | number | undefined>
        );
        return res;
      },
    },
    {
      name: "xhs_query_order_detail",
      description: "查询小红书订单详情",
      parameters: {
        type: "object",
        properties: {
          order_id: { type: "string", description: "订单 ID" },
        },
      },
      execute: async (params) => {
        const res = await xhsApiCallOrProxy(
          getConfig(),
          "/api/order/detail",
          "GET",
          params as Record<string, string | number | undefined>
        );
        return res;
      },
    },
    {
      name: "xhs_query_refunds",
      description: "查询小红书售后/退款列表",
      parameters: {
        type: "object",
        properties: {
          start_time: { type: "string" },
          end_time: { type: "string" },
          page: { type: "integer" },
          page_size: { type: "integer" },
        },
      },
      execute: async (params) => {
        const res = await xhsApiCallOrProxy(
          getConfig(),
          "/api/refund/list",
          "GET",
          params as Record<string, string | number | undefined>
        );
        return res;
      },
    },
    {
      name: "xhs_query_items",
      description: "查询小红书商品列表",
      parameters: {
        type: "object",
        properties: {
          page: { type: "integer" },
          page_size: { type: "integer" },
          item_status: { type: "string", description: "商品状态" },
        },
      },
      execute: async (params) => {
        const res = await xhsApiCallOrProxy(
          getConfig(),
          "/api/item/list",
          "GET",
          params as Record<string, string | number | undefined>
        );
        return res;
      },
    },
    {
      name: "xhs_item_on_off_shelf",
      description: "小红书商品上架或下架",
      parameters: {
        type: "object",
        properties: {
          item_id: { type: "string", description: "商品 ID" },
          on_shelf: { type: "boolean", description: "true 上架，false 下架" },
        },
      },
      execute: async (params) => {
        const res = await xhsApiCallOrProxy(
          getConfig(),
          "/api/item/shelf",
          "POST",
          params as Record<string, string | number | undefined>
        );
        return res;
      },
    },
    // 经营数据聚合：一次拉取多维度概览，供数字店长与日报复用（规格 §5.4）
    {
      name: "xhs_fetch_store_overview",
      description: "一次拉取店铺经营概览：订单量、售后待处理、在售商品数等；供数字店长与一键日报使用",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "日期 YYYY-MM-DD，默认当日" },
          shop_id: { type: "string", description: "店铺 ID，多店铺时指定" },
        },
      },
      execute: async (params) => {
        const config = getConfig();
        if (!config) return { error: "xhs channel not configured" };
        const dateStr =
          (params?.date as string) || new Date().toISOString().slice(0, 10);
        const start = `${dateStr} 00:00:00`;
        const end = `${dateStr} 23:59:59`;

        const [ordersRes, refundsRes, itemsRes] = await Promise.all([
          xhsApiCallOrProxy(config, "/api/order/list", "GET", {
            start_time: start,
            end_time: end,
            page: 1,
            page_size: 100,
          }),
          xhsApiCallOrProxy(config, "/api/refund/list", "GET", {
            start_time: start,
            end_time: end,
            page: 1,
            page_size: 100,
          }),
          xhsApiCallOrProxy(config, "/api/item/list", "GET", {
            page: 1,
            page_size: 100,
            item_status: "on_sale",
          }),
        ]);

        const hasError = (r: unknown) =>
          r && typeof r === "object" && "error" in r;
        const list = (r: unknown) =>
          Array.isArray((r as { data?: unknown[] })?.data)
            ? (r as { data: unknown[] }).data
            : Array.isArray((r as { list?: unknown[] })?.list)
              ? (r as { list: unknown[] }).list
              : [];
        const total = (r: unknown) =>
          typeof (r as { total?: number })?.total === "number"
            ? (r as { total: number }).total
            : list(r).length;

        const orderList = hasError(ordersRes) ? [] : list(ordersRes);
        const refundList = hasError(refundsRes) ? [] : list(refundsRes);
        const itemList = hasError(itemsRes) ? [] : list(itemsRes);

        return {
          date: dateStr,
          order_count: hasError(ordersRes) ? undefined : total(ordersRes),
          orders_first_page_count: orderList.length,
          refund_pending_count: hasError(refundsRes) ? undefined : total(refundsRes),
          refunds_first_page_count: refundList.length,
          item_on_sale_count: hasError(itemsRes) ? undefined : total(itemsRes),
          items_first_page_count: itemList.length,
          raw_orders: hasError(ordersRes) ? ordersRes : undefined,
          raw_refunds: hasError(refundsRes) ? refundsRes : undefined,
          raw_items: hasError(itemsRes) ? itemsRes : undefined,
        };
      },
    },
  ];
}

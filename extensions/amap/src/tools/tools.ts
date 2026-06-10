/**
 * 高德运营工具（Agent Tools）
 *
 * **架构角色**：向 OpenClaw 注册 Agent 可调用工具，封装高德 Web 服务 API，
 * 与《高德开放平台对接规格》EP-3 能力清单一致。
 *
 * **关键依赖**：
 * - `../types` — `ToolDefinition`、`AmapAccountConfig`
 * - `../amap/amap-api` — 统一 HTTP 调用层
 */

import type { ToolDefinition } from "../types.js";
import type { AmapAccountConfig } from "../types.js";
import { amapApiCall } from "../amap/amap-api.js";

/**
 * 创建高德 LBS 运营工具列表。
 *
 * 包含 POI 关键字查询、周边搜索、POI 详情三类工具；
 * 执行时通过 `getConfig()` 读取当前 API Key。
 *
 * @param getConfig - 读取 channels.amap 配置的 getter
 * @returns 可传给 `api.registerTool` 的工具定义数组
 */
export function createAmapTools(
  getConfig: () => AmapAccountConfig | undefined
): ToolDefinition[] {
  return [
    {
      name: "amap_query_poi",
      description: "高德 POI 查询：关键字、区域、城市或 ID 查询地点",
      parameters: {
        type: "object",
        properties: {
          keywords: { type: "string", description: "关键字" },
          region: { type: "string", description: "区域" },
          city: { type: "string", description: "城市" },
          id: { type: "string", description: "POI ID" },
          page: { type: "integer", description: "页码" },
          offset: { type: "integer", description: "每页条数" },
          types: { type: "string", description: "POI 类型编码" },
        },
      },
      execute: async (params) => {
        const p = params as Record<string, string | number | undefined>;
        // 有 id 时走详情接口，否则走关键字搜索
        const path = p?.id ? "/v3/place/detail" : "/v3/place/text";
        return amapApiCall(getConfig(), path, p ?? {});
      },
    },
    {
      name: "amap_query_around",
      description: "高德周边 POI 搜索：按经纬度与半径、关键字查询周边地点",
      parameters: {
        type: "object",
        properties: {
          location: { type: "string", description: "中心点经纬度" },
          keywords: { type: "string", description: "关键字" },
          radius: { type: "string", description: "半径（米）" },
          sortrule: { type: "string", description: "排序规则" },
          page: { type: "integer" },
          offset: { type: "integer" },
        },
      },
      execute: async (params) => {
        return amapApiCall(getConfig(), "/v3/place/around", (params ?? {}) as Record<string, string | number | undefined>);
      },
    },
    {
      name: "amap_place_detail",
      description: "高德 POI 详情：根据 ID 查询地点详情",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "POI ID" },
        },
      },
      execute: async (params) => {
        return amapApiCall(getConfig(), "/v3/place/detail", (params ?? {}) as Record<string, string | number | undefined>);
      },
    },
  ];
}

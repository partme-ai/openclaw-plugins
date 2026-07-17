/**
 * @fileoverview 高德地图 Web Service 工具插件的注册入口。
 *
 * 插件启用后创建共享 `AmapClient`，并向 OpenClaw 注册地点关键词搜索、周边搜索和 POI 详情
 * 三个工具；配置缺失时保持禁用，API 参数校验和 owner-only 权限由工具层执行。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { definePluginEntry, type OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { AmapClient } from "./amap/amap-api.js";
import { resolveAmapConfig } from "./config.js";
import { AMAP_TOOL_NAMES, createAmapTools } from "./tools/tools.js";

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "amap",
  name: "AMap Web Service",
  description: "高德 Web 服务 API 地点搜索工具",
  register(api: OpenClawPluginApi) {
    const config = resolveAmapConfig(api.pluginConfig);
    if (!config) {
      api.logger.info("[amap] Disabled");
      return;
    }
    const client = new AmapClient(config);
    AMAP_TOOL_NAMES.forEach((name, index) => {
      api.registerTool((ctx) => createAmapTools(ctx, config, client)[index]!, { name });
    });
    api.logger.info(`[amap] ${AMAP_TOOL_NAMES.length} Web Service tools registered`);
  },
});

export { AmapClient, AmapApiError, signAmapRequest } from "./amap/amap-api.js";
export { resolveAmapConfig } from "./config.js";
export { createAmapTools, AMAP_TOOL_NAMES } from "./tools/tools.js";
export type { AmapPluginConfig, AmapApiResponse, AmapClientStatus } from "./types.js";
export default plugin;

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

export { AmapClient, AmapApiError } from "./amap/amap-api.js";
export { resolveAmapConfig } from "./config.js";
export { createAmapTools, AMAP_TOOL_NAMES } from "./tools/tools.js";
export type { AmapPluginConfig, AmapApiResponse } from "./types.js";
export default plugin;

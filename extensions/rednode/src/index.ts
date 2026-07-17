/**
 * @fileoverview 小红书 Rednode Ark Open API 工具插件的注册入口。
 *
 * 配置有效时创建共享 `RednodeClient` 并注册一个白名单调用工具；Agent 无法传入任意 API
 * 路径，operation 选择、参数校验、签名和限流均由工具层及客户端层共同约束。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { definePluginEntry, type OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { RednodeApiError, RednodeClient, signRednodeRequest } from "./agent/xhs-api.js";
import { resolveRednodeConfig } from "./config.js";
import { createRednodeTool, REDNODE_TOOL_NAME } from "./tools/tools.js";

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "rednode",
  name: "Rednode Ark Open API",
  description: "小红书 Ark Open API 配置化白名单工具",
  register(api: OpenClawPluginApi) {
    const config = resolveRednodeConfig(api.pluginConfig);
    if (!config) { api.logger.info("[rednode] Disabled"); return; }
    const client = new RednodeClient(config);
    api.registerTool((ctx) => createRednodeTool(ctx, config, client), { name: REDNODE_TOOL_NAME });
    api.logger.info(`[rednode] Ark tool registered with ${config.operations.length} allowlisted operations`);
  },
});

export { RednodeApiError, RednodeClient, signRednodeRequest };
export { resolveRednodeConfig } from "./config.js";
export { createRednodeTool, REDNODE_TOOL_NAME } from "./tools/tools.js";
export type { RednodeApiResponse, RednodeClientStatus, RednodeOperation, RednodePluginConfig } from "./types.js";
export default plugin;

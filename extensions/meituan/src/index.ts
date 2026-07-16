/**
 * @fileoverview 美团 MTOp OpenAPI 工具插件的注册入口。
 *
 * 启用后创建共享 `MeituanClient` 并注册单一受控调用工具；Agent 只能访问配置白名单中的
 * operation，具体签名、限流、超时和响应大小限制由客户端层负责。
 */
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { definePluginEntry, type OpenClawPluginDefinition } from "openclaw/plugin-sdk/plugin-entry";
import { resolveMeituanConfig } from "./config.js";
import { MeituanApiError, MeituanClient, signMeituanParams } from "./meituan/meituan-api.js";
import { createMeituanTool, MEITUAN_TOOL_NAME } from "./tools/tools.js";

const plugin: OpenClawPluginDefinition = definePluginEntry({
  id: "meituan",
  name: "Meituan MTOp OpenAPI",
  description: "配置化调用美团技术服务合作中心 MTOp OpenAPI",
  register(api: OpenClawPluginApi) {
    const config = resolveMeituanConfig(api.pluginConfig);
    if (!config) {
      api.logger.info("[meituan] Disabled");
      return;
    }
    const client = new MeituanClient(config);
    api.registerTool((ctx) => createMeituanTool(ctx, config, client), { name: MEITUAN_TOOL_NAME });
    api.logger.info(`[meituan] MTOp tool registered with ${config.operations.length} allowlisted operations`);
  },
});

export { resolveMeituanConfig } from "./config.js";
export { MeituanApiError, MeituanClient, signMeituanParams };
export { createMeituanTool, MEITUAN_TOOL_NAME } from "./tools/tools.js";
export type { MeituanApiResponse, MeituanOperation, MeituanPluginConfig } from "./types.js";
export default plugin;

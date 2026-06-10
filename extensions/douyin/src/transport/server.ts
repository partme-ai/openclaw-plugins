/**
 * HTTP Webhook 传输入口（薄 re-export）。
 *
 * **架构角色**：对外统一导出 Gateway 注册的 handler 工厂，便于测试或文档引用
 * 而不直接依赖 `inbound.ts` 路径。
 */

export {
  createDouyinPluginHttpHandler,
  type DouyinGatewayLog,
} from "../inbound.js";

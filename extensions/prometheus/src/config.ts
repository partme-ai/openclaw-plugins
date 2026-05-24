/**
 * Prometheus 插件配置解析入口（Base Profile 平铺文件）。
 */

export {
  resolvePrometheusConfig,
  scrapeTokenEnvName,
  type PrometheusPluginUserConfig,
  type ResolvedPrometheusConfig,
} from "./config/plugin-config.js";

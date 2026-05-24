/**
 * @fileoverview Prometheus 配置解析入口（Base 平铺）。
 *
 * @description re-export plugin-config 模块的类型与 resolvePrometheusConfig。
 *
 * @module config
 */

export {
  resolvePrometheusConfig,
  scrapeTokenEnvName,
  type PrometheusPluginUserConfig,
  type ResolvedPrometheusConfig,
} from "./config/plugin-config.js";

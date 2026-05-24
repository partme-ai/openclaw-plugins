/**
 * Prometheus 插件运行时入口（Base Profile 平铺文件）。
 */

export {
  setRuntime,
  getRuntime,
  isReady,
  rpcCall,
  rpcBatch,
  getConfig,
} from "./runtime/ws-bridge.js";

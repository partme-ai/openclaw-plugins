/**
 * @fileoverview Prometheus Runtime 入口（Base 平铺）。
 *
 * @description re-export ws-bridge 层的 Gateway RPC 与配置访问 API。
 *
 * @module runtime
 */

export {
  setRuntime,
  getRuntime,
  isReady,
  rpcCall,
  rpcBatch,
  getConfig,
} from "./runtime/ws-bridge.js";

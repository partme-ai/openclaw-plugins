/**
 * WeChat iPad 传输层入口：WebSocket 桥接与 HTTP API。
 */

export {
  startBridge,
  stopBridge,
  getBridgeState,
  getBridgeStatusSummary,
  getLoginInfo,
  getServiceStatus,
  sendMessage,
  on,
} from "./ipad-bridge.js";

/**
 * WeChat iPad 传输层入口：WebSocket 桥接与 HTTP API。
 */

export {
  WechatIpadBridge,
  getActiveBridge,
  setActiveBridge,
  getBridgeStatusSummary,
  getServiceStatus,
  sendMessage,
} from "./ipad-bridge.js";

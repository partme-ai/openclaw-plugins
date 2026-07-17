/**
 * @fileoverview 微信 iPad 外部桥接插件的 OpenClaw 注册入口。
 *
 * 这里负责把 Channel、运行时、桥接服务和受 Gateway 保护的状态路由组装到同一个插件
 * 生命周期中。底层协议连接由 `WechatIpadBridge` 管理，入站处理器只在服务启动成功或进入
 * 后台重连后保持注册，停止时则按“监听器 → Socket → 缓存 → Runtime”的顺序彻底释放。
 */
import {
  defineChannelPluginEntry,
  type OpenClawPluginApi,
} from "openclaw/plugin-sdk/core";
import { wechatIpadChannel } from "./channel.js";
import {
  setWechatIpadRuntime,
} from "./runtime.js";
import { getBridgeStatusSummary } from "./transport/ipad-bridge.js";

/** 注册需要完整 Gateway 能力的服务和 HTTP 状态端点。 */
function registerFull(api: OpenClawPluginApi): void {
  // 网络生命周期由 Channel gateway.startAccount 管理；完整注册阶段只提供受 Gateway 认证保护的状态路由。
  api.registerHttpRoute({
    path: "/wechat-ipad/status",
    auth: "gateway",
    match: "exact",
    handler: (_req, res) => {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ ok: true, data: getBridgeStatusSummary() }));
    },
  });
}

const entry: ReturnType<typeof defineChannelPluginEntry> = defineChannelPluginEntry({
  id: "wechat-ipad",
  name: "WeChat iPad External Bridge",
  description: "Opt-in OpenClaw channel for a separately operated, unofficial WeChat iPad bridge.",
  plugin: wechatIpadChannel,
  setRuntime: setWechatIpadRuntime,
  registerFull,
});

export { wechatIpadChannel } from "./channel.js";
export { WechatIpadBridge } from "./transport/ipad-bridge.js";
export { resolveWechatIpadConfig } from "./config.js";
export default entry;

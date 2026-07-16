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
import { getWechatIpadSection, resolveWechatIpadConfig } from "./config.js";
import { clearRecentWechatIpadMessages, registerWechatIpadEventHandlers } from "./inbound.js";
import {
  clearWechatIpadRuntime,
  setResolvedWechatIpadConfig,
  setWechatIpadRuntime,
} from "./runtime.js";
import {
  WechatIpadBridge,
  getBridgeStatusSummary,
  setActiveBridge,
} from "./transport/ipad-bridge.js";

function resolveApiConfig(api: OpenClawPluginApi) {
  const pluginConfig = api.pluginConfig ?? {};
  const raw = Object.keys(pluginConfig).length > 0
    ? pluginConfig
    : getWechatIpadSection(api.config as unknown as Record<string, unknown>);
  return resolveWechatIpadConfig(raw);
}

/** 注册需要完整 Gateway 能力的服务和 HTTP 状态端点。 */
function registerFull(api: OpenClawPluginApi): void {
  let bridge: WechatIpadBridge | null = null;
  let disposeHandlers: (() => void) | null = null;

  api.registerService({
    id: "wechat-ipad-external-bridge",
    async start() {
      const config = resolveApiConfig(api);
      setResolvedWechatIpadConfig(config);
      if (!config.enabled) {
        api.logger.info("[wechat-ipad] disabled; external bridge was not started");
        return;
      }
      bridge = new WechatIpadBridge(config, api.logger);
      setActiveBridge(bridge);
      disposeHandlers = registerWechatIpadEventHandlers(bridge, config, api.logger);
      try {
        await bridge.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (config.required) {
          // required 模式必须回滚已注册资源，避免启动失败后留下半活动桥接器。
          disposeHandlers();
          disposeHandlers = null;
          await bridge.stop();
          bridge = null;
          setActiveBridge(null);
          throw error;
        }
        api.logger.warn(`[wechat-ipad] initial connection failed; reconnecting in background: ${message}`);
      }
    },
    async stop() {
      // 先阻止新事件进入，再关闭连接；最后清理跨生命周期的缓存和 Runtime 引用。
      disposeHandlers?.();
      disposeHandlers = null;
      await bridge?.stop();
      bridge = null;
      setActiveBridge(null);
      clearRecentWechatIpadMessages();
      clearWechatIpadRuntime();
    },
  });

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

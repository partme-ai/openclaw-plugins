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

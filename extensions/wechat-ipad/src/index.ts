/**
 * openclaw_wechat_ipad 插件入口
 *
 * 微信 iPad 协议桥接插件 —— 通过外部 iPad 协议服务实现
 * 个人微信号与 OpenClaw Agent 的双向消息对接。
 */

import type { PluginApi } from "./types.js";
import { wechatIpadChannel } from "./channel.js";
import {
  startBridge,
  stopBridge,
  getBridgeStatusSummary,
  getServiceStatus,
} from "./transport/server.js";
import {
  getSessionStats,
  listSessions,
  clearAllSessions,
} from "./routing/session-mapper.js";
import { resolveWechatIpadConfig } from "./config.js";
import {
  registerWechatIpadEventHandlers,
} from "./inbound.js";
import {
  setWechatIpadRuntime,
  setResolvedWechatIpadConfig,
} from "./runtime.js";

/**
 * 安全的 onReady 替代方案
 * 优先 registerService → onReady → 延迟执行
 *
 * @param api - 插件 API
 * @param name - 服务名称
 * @param callback - 就绪回调
 */
function safeOnReady(
  api: PluginApi,
  name: string,
  callback: () => Promise<void>,
): void {
  const a = api as unknown as Record<string, unknown>;
  if (typeof a.registerService === "function") {
    (a.registerService as (def: { id: string; start: () => Promise<void> }) => void)({
      id: name,
      start: callback,
    });
  } else if (typeof a.onReady === "function") {
    (a.onReady as (cb: () => Promise<void>) => void)(callback);
  } else {
    Promise.resolve()
      .then(() => callback())
      .catch((e) => console.error(`[${name}] Startup error:`, e));
  }
}

/**
 * 注册 HTTP 状态查询端点
 *
 * @param api - 插件 API
 */
function registerHttpRoutes(api: PluginApi): void {
  api.registerHttpRoute({
    path: "/wechat-ipad/status",
    handler: async (_req, res) => {
      const bridgeStatus = getBridgeStatusSummary();
      const sessionStats = getSessionStats();
      let serviceStatus: Record<string, unknown> | null = null;

      try {
        const svcResult = await getServiceStatus();
        serviceStatus = svcResult.ok ? (svcResult.data as Record<string, unknown>) : null;
      } catch {
        serviceStatus = null;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          data: {
            bridge: bridgeStatus,
            sessions: sessionStats,
            service: serviceStatus,
          },
        }),
      );
    },
  });

  api.registerHttpRoute({
    path: "/wechat-ipad/sessions",
    handler: async (_req, res) => {
      const sessions = listSessions();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: sessions }));
    },
  });
}

/**
 * 插件注册入口
 * 由 OpenClaw Gateway 在加载插件时调用
 *
 * @param api - Gateway 注入的插件 API
 */
export default function register(api: PluginApi): void {
  setWechatIpadRuntime(api.runtime);

  api.registerChannel({ plugin: wechatIpadChannel });

  registerHttpRoutes(api);

  safeOnReady(api, "wechat-ipad-bridge", async () => {
    const config = resolveWechatIpadConfig(api.runtime.config);
    setResolvedWechatIpadConfig(config);

    registerWechatIpadEventHandlers(config);

    try {
      startBridge(config);
      console.log("[wechat-ipad] Bridge started successfully");
    } catch (err) {
      console.error("[wechat-ipad] Failed to start bridge:", err);
    }
  });

  console.log("[wechat-ipad] Plugin registered — WeChat iPad channel ready");
  console.log("[wechat-ipad] Endpoints:");
  console.log("  /wechat-ipad/status  — Bridge & login status");
  console.log("  /wechat-ipad/sessions — Active session list");
}

process.on("SIGTERM", async () => {
  console.log("[wechat-ipad] Shutting down...");
  stopBridge();
  clearAllSessions();
});

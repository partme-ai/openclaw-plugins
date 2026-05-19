/**
 * openclaw_wechat_ipad 插件入口
 *
 * 微信 iPad 协议桥接插件 —— 通过外部 iPad 协议服务实现
 * 个人微信号与 OpenClaw Agent 的双向消息对接。
 *
 * 核心职责：
 * - 注册 wechat-ipad channel 到 OpenClaw
 * - 建立与 iPad 协议服务的 WebSocket 桥接连接
 * - 入站消息：微信用户消息 → 消息转换 → Agent 处理
 * - 出站消息：Agent 回复 → iPad Bridge HTTP API → 微信
 * - 会话管理：wxid ↔ sessionKey 映射
 * - 登录状态监控与 HTTP 状态端点
 *
 * 架构总览：
 *
 *   微信服务器
 *       ↕ MMTLS / Protobuf
 *   iPad 协议服务（独立进程）
 *       ↕ WebSocket 事件推送 + HTTP API 发送
 *   openclaw_wechat_ipad（本插件）
 *       ↕ OpenClaw Runtime 消息管道
 *   OpenClaw Gateway → Agent
 */

import type {
  PluginApi,
  GatewayRuntime,
  WechatIpadConfig,
  WxMessagePayload,
  WxLoginPayload,
  WxFriendRequestPayload,
  IpadEventType,
} from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";
import { wechatIpadChannel } from "./channel.js";
import {
  startBridge,
  stopBridge,
  getBridgeState,
  getBridgeStatusSummary,
  getLoginInfo,
  getServiceStatus,
  on as onBridgeEvent,
} from "./ipad-bridge.js";
import {
  getOrCreateSession,
  getSessionStats,
  listSessions,
  clearAllSessions,
} from "./session-mapper.js";
import { inboundToText } from "./message-converter.js";

/** Gateway Runtime 引用（消息管道调度） */
let _runtime: GatewayRuntime | null = null;

/** 当前解析后的插件配置 */
let _resolvedConfig: WechatIpadConfig | null = null;

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
  callback: () => Promise<void>
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
 * 插件注册入口
 * 由 OpenClaw Gateway 在加载插件时调用
 *
 * @param api - Gateway 注入的插件 API
 */
export default function register(api: PluginApi): void {
  _runtime = api.runtime;

  // ──────────── 注册 Channel ────────────
  api.registerChannel({ plugin: wechatIpadChannel });

  // ──────────── 注册 HTTP 状态端点 ────────────
  registerHttpRoutes(api);

  // ──────────── 启动 iPad 协议桥接 ────────────
  safeOnReady(api, "wechat-ipad-bridge", async () => {
    const config = resolveConfig(api.runtime.config);
    _resolvedConfig = config;

    // 注册消息事件监听
    registerEventHandlers(config);

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

// ─────────────────── 事件处理 ───────────────────

/**
 * 注册 iPad 协议桥接事件监听器
 * 将微信事件转换为 OpenClaw 消息管道调用
 *
 * @param config - 插件配置
 */
function registerEventHandlers(config: WechatIpadConfig): void {
  // 处理微信消息
  onBridgeEvent<WxMessagePayload>("message" as IpadEventType, (msg) => {
    handleWxMessage(msg, config);
  });

  // 处理登录状态变更
  onBridgeEvent<WxLoginPayload>("login_status" as IpadEventType, (payload) => {
    if (payload.status === "logged_out" || payload.status === "token_expired") {
      clearAllSessions();
      console.log("[wechat-ipad] Sessions cleared due to logout/token expiry");
    }
  });

  // 处理好友请求（记录日志，可扩展为自动通过）
  onBridgeEvent<WxFriendRequestPayload>("friend_request" as IpadEventType, (req) => {
    console.log(
      `[wechat-ipad] Friend request from ${req.nickname} (${req.fromWxid}): ${req.verifyContent}`
    );
  });
}

/**
 * 处理微信入站消息
 * 应用过滤规则后交给 OpenClaw Runtime 消息管道
 *
 * @param msg - 微信消息负载
 * @param config - 插件配置
 */
function handleWxMessage(
  msg: WxMessagePayload,
  config: WechatIpadConfig
): void {
  // 过滤自己发送的消息
  if (config.message.ignoreself && msg.isSelf) return;

  // 过滤群消息（未开启群消息处理或不在白名单中）
  if (msg.isGroup) {
    if (!config.message.handleGroup) return;

    const whitelist = config.message.groupWhitelist;
    if (whitelist.length > 0) {
      const groupWxid = msg.isGroup ? msg.toWxid : null;
      if (groupWxid && !whitelist.includes(groupWxid)) return;
    }
  }

  // 转换消息为 Agent 可处理的文本
  const text = inboundToText(msg);
  if (!text) return;

  // 确定消息来源 wxid（群消息取实际发言人，私聊取 fromWxid）
  const senderWxid = msg.isGroup
    ? msg.groupSenderWxid ?? msg.fromWxid
    : msg.fromWxid;

  // 确定会话 wxid（私聊用对方 wxid，群聊用群 wxid）
  const conversationWxid = msg.isGroup ? msg.toWxid : msg.fromWxid;

  console.log(
    `[wechat-ipad] Inbound: from=${senderWxid}, conv=${conversationWxid}, ` +
    `group=${msg.isGroup}, text=${text.slice(0, 80)}`
  );

  // 异步调用 Runtime 消息管道
  dispatchToRuntime(conversationWxid, senderWxid, text, msg.isGroup).catch(
    (error) => {
      console.error(
        `[wechat-ipad] Runtime dispatch failed for ${conversationWxid}:`,
        error
      );
    }
  );
}

/**
 * 通过 OpenClaw Runtime 4 步管道处理入站消息
 *
 * @param conversationWxid - 会话 wxid（私聊为对方，群聊为群）
 * @param senderWxid - 发送者 wxid
 * @param text - 转换后的消息文本
 * @param isGroup - 是否群消息
 */
async function dispatchToRuntime(
  conversationWxid: string,
  senderWxid: string,
  text: string,
  isGroup: boolean
): Promise<void> {
  if (!_runtime) {
    console.warn("[wechat-ipad] Runtime not initialized, cannot dispatch");
    return;
  }

  const cfg = _runtime.config;

  // Step 1: 路由到目标 Agent
  const route = await _runtime.channel.routing.resolveAgentRoute({
    cfg,
    channel: "wechat-ipad",
    accountId: "default",
    peer: {
      kind: isGroup ? "group" : "dm",
      id: conversationWxid,
    },
  });

  // 创建/获取会话映射
  const sessionKey = getOrCreateSession(
    conversationWxid,
    route.agentId,
    isGroup
  );

  // Step 2: 构造入站上下文
  const ctx = await _runtime.channel.reply.finalizeInboundContext({
    channel: "wechat-ipad",
    accountId: "default",
    from: senderWxid,
    text,
    chatType: isGroup ? "group" : "direct",
    extra: {
      conversationWxid,
      senderWxid,
      isGroup,
    },
  });

  // Step 3: 创建回复分发器
  const dispatcher = _runtime.channel.reply.createReplyDispatcherWithTyping({
    deliver: async (payload) => {
      const { sendMessage } = await import("./ipad-bridge.js");
      const { outboundFromText } = await import("./message-converter.js");

      const request = outboundFromText(conversationWxid, payload.text);
      const result = await sendMessage(request);

      if (!result.ok) {
        console.error(
          `[wechat-ipad] Streaming reply failed for ${conversationWxid}: ${result.error}`
        );
      }
    },
  });

  // Step 4: 触发 Agent 处理
  await _runtime.channel.reply.dispatchReplyFromConfig({
    ctx,
    cfg,
    dispatcher,
    replyOptions: route,
  });
}

// ─────────────────── HTTP 端点 ───────────────────

/**
 * 注册 HTTP 状态查询端点
 *
 * @param api - 插件 API
 */
function registerHttpRoutes(api: PluginApi): void {
  // 桥接状态与登录信息
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
        })
      );
    },
  });

  // 活跃会话列表
  api.registerHttpRoute({
    path: "/wechat-ipad/sessions",
    handler: async (_req, res) => {
      const sessions = listSessions();

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: sessions }));
    },
  });
}

// ─────────────────── 配置解析 ───────────────────

/**
 * 从 OpenClaw 全局配置中解析插件配置
 * 合并默认配置和用户自定义配置
 *
 * @param globalConfig - OpenClaw 全局配置
 * @returns 合并后的插件配置
 */
function resolveConfig(
  globalConfig: Record<string, unknown>
): WechatIpadConfig {
  const channels = globalConfig.channels as Record<string, unknown> | undefined;
  const raw = channels?.["wechat-ipad"] as Partial<WechatIpadConfig> | undefined;

  if (!raw) return { ...DEFAULT_CONFIG };

  return {
    serviceUrl: raw.serviceUrl ?? DEFAULT_CONFIG.serviceUrl,
    apiUrl: raw.apiUrl ?? DEFAULT_CONFIG.apiUrl,
    reconnect: {
      enabled: raw.reconnect?.enabled ?? DEFAULT_CONFIG.reconnect.enabled,
      intervalMs: raw.reconnect?.intervalMs ?? DEFAULT_CONFIG.reconnect.intervalMs,
      maxRetries: raw.reconnect?.maxRetries ?? DEFAULT_CONFIG.reconnect.maxRetries,
    },
    auth: {
      token: raw.auth?.token ?? DEFAULT_CONFIG.auth.token,
    },
    message: {
      handleGroup: raw.message?.handleGroup ?? DEFAULT_CONFIG.message.handleGroup,
      groupWhitelist: raw.message?.groupWhitelist ?? DEFAULT_CONFIG.message.groupWhitelist,
      ignoreself: raw.message?.ignoreself ?? DEFAULT_CONFIG.message.ignoreself,
    },
  };
}

// ─────────────────── 进程退出 ───────────────────

process.on("SIGTERM", async () => {
  console.log("[wechat-ipad] Shutting down...");
  stopBridge();
  clearAllSessions();
});

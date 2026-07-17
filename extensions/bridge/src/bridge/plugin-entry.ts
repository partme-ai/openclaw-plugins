/**
 * @fileoverview OpenClaw Bridge 插件的根定义对象（宿主 `register` 绑定目标）。
 *
 * @description
 * - **角色**：组装 Bridge 的两条核心扩展——上下文注入（`before_prompt_build`）
 *   与消息桥接（`message_received` / `message_sent` → MQ）。
 * - **配置契约**：`configSchema` 与宿主侧插件配置的 JSON Schema 对齐，缺省行为由各子模块在运行时解释。
 * - **可见性**：默认导出即插件清单；`register(api)` 为唯一副作用入口。
 *
 * @module bridge/plugin-entry
 */

/**
 * OpenClaw Bridge 插件定义（register 入口）。
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { registerContextInjection } from "./context-inject.js";
import { registerMessageBridge, validateBridgeConfig, type BridgeConfig } from "./message-bridge.js";
import { ALL_CHANNELS } from "./channels.js";
import { setBridgeRuntime } from "../runtime.js";

/**
 * @description Bridge 插件清单：元数据、JSON Schema 形态的配置声明，以及注册函数。
 *
 * @property id - 插件全局唯一 ID（与包名/文档引用保持一致）。
 * @property name - 人类可读名称。
 * @property description - 简短说明（面向 UI / marketplace）。
 * @property configSchema - JSON Schema 子集：定义 `channels` 映射及每渠道布尔/字符串开关。
 */
const plugin = {
  id: "bridge",
  name: "OpenClaw Bridge",
  description:
    `跨渠道上下文与消息观测桥 — ${ALL_CHANNELS.length} 个渠道统一预设、规范化和 MQ 镜像`,
  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      channels: {
        type: "object",
        additionalProperties: {
          type: "object",
          properties: {
            enabled: { type: "boolean", default: true },
            forwardToMq: { type: "boolean", default: true },
            mqChannel: {
              type: "string",
              enum: ["mqtt", "mqtt-ws", "web-mqtt", "rabbitmq", "redis-stream", "rocketmq", "stomp", "web-stomp", "stomp-tcp"],
              default: "mqtt",
            },
            mqAccountId: { type: "string" },
            topicPrefix: { type: "string", minLength: 1 },
            contextInjection: { type: "boolean", default: true },
            includeMediaUrls: { type: "boolean", default: false },
          },
          additionalProperties: false,
        },
      },
      delivery: {
        type: "object",
        additionalProperties: false,
        properties: {
          maxAttempts: { type: "integer", minimum: 1, default: 3 },
          retryDelayMs: { type: "integer", minimum: 1, default: 250 },
          publishTimeoutMs: { type: "integer", minimum: 1, default: 5000 },
          maxPayloadBytes: { type: "integer", minimum: 1, default: 1048576 },
          maxInFlight: { type: "integer", minimum: 1, default: 4 },
          maxBufferedMessages: { type: "integer", minimum: 1, default: 1024 },
          shutdownTimeoutMs: { type: "integer", minimum: 1, default: 10000 },
        },
      },
    },
  },
  /**
   * @description 向宿主注册事件监听：初始化日志、挂载上下文注入与消息桥接。
   * @param api - OpenClaw 插件 API。
   * @returns void
   * @throws 本方法不抛出同步异常。
   */
  register(api: OpenClawPluginApi) {
    if (api.registrationMode !== "full") return;
    // 在任何 Hook、Service 或全局 runtime 引用注册之前校验，保证错误配置原子失败。
    validateBridgeConfig((api.pluginConfig ?? {}) as BridgeConfig);
    setBridgeRuntime(api);
    api.logger.info(`[openclaw-bridge] Initializing — ${ALL_CHANNELS.length} channels available`);

    registerContextInjection(api);
    registerMessageBridge(api);

    api.logger.info("[openclaw-bridge] Ready");
  },
};

export default plugin;

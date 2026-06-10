/**
 * @module core
 *
 * 统一消息核心模块 barrel export。
 *
 * **职责**：对外暴露 UnifiedMessage 类型、信封结构、通道类别常量及构造/解析工具。
 *
 * **子模块**：`types`、`message`、`envelope`、`channel-class`
 */

export * from "./types.js";
export * from "./message.js";
export * from "./envelope.js";
export * from "./channel-class.js";

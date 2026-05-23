/**
 * index.ts — 统一消息核心模型、信封结构与基础构造/解析工具。
 *
 * 本文件作为 core 模块的一部分，负责对外暴露稳定 API 或组织子模块出口；注释用于说明职责边界，避免通道插件重复实现同类逻辑。
 */

export * from "./types.js";
export * from "./message.js";
export * from "./envelope.js";
export * from "./channel-class.js";

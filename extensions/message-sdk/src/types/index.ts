/**
 * @module types
 *
 * 公共类型重导出 — 统一消息类型与核心 envelope 类型。
 *
 * **职责**：为依赖 `@partme.ai/openclaw-message-sdk/types` 子路径的通道插件
 * 提供与包根 export 一致的类型入口。
 *
 * **来源**：openclaw-china packages/shared/src/types/ (MIT License)
 *
 * **关键导出**：`UnifiedMessage`、`MediaReference`、`MessageDirection` 等
 */

export type { UnifiedMessage, MediaReference, MediaKind, MessageContentType, MessageDirection } from "../index.js";

/**
 * @module openclaw/index
 *
 * OpenClaw 兼容层薄封装 / Thin OpenClaw compatibility layer.
 *
 * **职责**：聚合 peer 动态加载与状态目录解析，供 message-sdk 及通道插件统一引用。
 *
 * **关键导出**：`importOpenClawPluginSdk`、`resolveOpenClawStateDir`
 */

export { importOpenClawPluginSdk } from "./loader.js";
export { resolveOpenClawStateDir } from "./state-dir.js";

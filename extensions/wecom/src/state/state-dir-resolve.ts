/**
 * OpenClaw 状态目录解析（state-dir-resolve）
 *
 * 薄 re-export：委托 message-sdk `resolveOpenClawStateDir`，供 openclaw-compat 构建
 * 默认媒体本地根路径（state/media、agents、workspace 等）时使用。
 *
 * 插件内统一从此模块或 openclaw-compat 导入，避免直接依赖 SDK 路径分散。
 */
export { resolveOpenClawStateDir as resolveStateDir } from "@partme.ai/openclaw-message-sdk/openclaw";
